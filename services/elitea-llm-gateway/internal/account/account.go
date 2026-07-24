// Package account implements the bifrost/core schemas.Account interface for the
// elitea-llm-gateway.
//
// It is the sole credential coupling point between the gateway and bifrost/core
// (design §5.2, §6.1). Provider credentials are never minted or persisted by the
// gateway: the Fernet-encrypted vault (centry.secrets_*) remains the source of
// truth and per-project provider settings live in the p_{projectID}.configuration
// table (section 'ai_credentials'). Credentials are read per request, decrypted,
// and handed to core as schemas.Key values — raw key material is never logged,
// returned to callers, or otherwise surfaced.
//
// # Account interface shape (validated against core/schemas/account.go @ v1.7.3)
//
//	GetConfiguredProviders() ([]schemas.ModelProvider, error)
//	GetKeysForProvider(ctx context.Context, provider schemas.ModelProvider) ([]schemas.Key, error)
//	GetConfigForProvider(provider schemas.ModelProvider) (*schemas.ProviderConfig, error)
//
// Only GetKeysForProvider carries a context.Context. GetConfiguredProviders and
// GetConfigForProvider are invoked without one — at bifrost.Init to prewarm
// provider workers and lazily on first request for a provider (bifrost.go
// 317/356/4398). Per-project credential resolution therefore MUST happen in
// GetKeysForProvider: it reads the resolved projectID from the request context
// (BifrostContextKeyVirtualKey, set by the /llm handler from the signed
// X-Elitea-Project-Id header) and returns only that project's keys. The other
// two methods return a static supported-provider set and a tuned ProviderConfig;
// a project with no credential for a provider simply yields zero keys.
package account

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
)

// SelfReferentialCredentialReason is the rejection reason emitted when a
// provider credential's api_base resolves to the platform's own /llm origin.
// This replicates the legacy tools/mappers/integration/open_ai.py guard
// (api_base == get_base_url()) and prevents a request routed through the
// gateway from looping straight back into it (spec §2.6 guard #1, design §4.3).
const SelfReferentialCredentialReason = "SELF_REFERENTIAL_CREDENTIAL"

// ErrSelfReferentialCredential is returned when a credential is rejected by the
// self-referential guard. It carries SelfReferentialCredentialReason so callers
// can map it to the HTTP 400 invalid_request_error response (spec §2.5).
var ErrSelfReferentialCredential = errors.New(SelfReferentialCredentialReason)

// supportedProviders is the static set of providers the gateway can serve. It is
// intentionally not per-project: per-project availability is expressed by
// GetKeysForProvider returning zero keys for a provider a project has not
// configured. Keeping this static lets bifrost.Init prewarm a bounded, tuned
// worker pool per provider without a database round-trip at startup (§6.1).
//
// Each entry maps to a provider bifrost/core can construct at Init without a key
// (createBaseProvider, bifrost.go:4234 — keys are supplied per request).
var supportedProviders = []schemas.ModelProvider{
	schemas.OpenAI,
	schemas.Azure,
	schemas.Anthropic,
	schemas.Bedrock,
	schemas.Vertex,
	schemas.Ollama,
}

// rowQuerier is the minimal pgx surface the account needs. It is satisfied by
// *pgxpool.Pool and by test fakes, keeping the package unit-testable without a
// live database (mirrors the elitea-main handler DB-abstraction idiom).
type rowQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgxRows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgxRow
}

// pgxRow mirrors pgx.Row (Scan-only).
type pgxRow interface {
	Scan(dest ...any) error
}

// pgxRows mirrors the subset of pgx.Rows the account consumes.
type pgxRows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
	Close()
}

// vaultDecryptor resolves a project secret reference ({{secret.NAME}}) to its
// plaintext value by reading and decrypting the project's Fernet vault. It is an
// interface so tests can supply an in-memory implementation; the production
// implementation is *fernetVault (vault.go), which reads centry.secrets_*.
type vaultDecryptor interface {
	// Resolve returns the plaintext for secretRef within the given project. When
	// secretRef is not a {{secret.NAME}} reference it is returned verbatim.
	Resolve(ctx context.Context, projectID, secretRef string) (string, error)
}

// EliteaAccount implements schemas.Account backed by Elitea's Postgres store.
type EliteaAccount struct {
	db    rowQuerier
	vault vaultDecryptor

	// providerConcurrency caps the worker goroutines bifrost spawns per provider,
	// tuning ConcurrencyAndBufferSize.Concurrency down from the 1000-worker
	// default (design §9.5, §6.1).
	providerConcurrency int

	// selfOrigins holds the normalised origins of the platform's own /llm
	// surface. Any credential api_base whose origin matches one of these is
	// rejected by the self-referential guard.
	selfOrigins map[string]struct{}

	logger *slog.Logger
}

var _ schemas.Account = (*EliteaAccount)(nil)

// Config configures a new EliteaAccount.
type Config struct {
	// DB is the Postgres handle (*pgxpool.Pool in production). Required.
	DB rowQuerier
	// Vault resolves {{secret.NAME}} references from the Fernet vault. Required.
	Vault vaultDecryptor
	// ProviderConcurrency caps per-provider worker goroutines (§9.5). When <= 0
	// bifrost's CheckAndSetDefaults applies its own default.
	ProviderConcurrency int
	// SelfOrigins are the platform's own /llm origins (e.g.
	// "https://dev.elitea.ai/llm/v1", "http://pylon_main:8080/llm/v1"). Any
	// credential api_base matching one of these origins is rejected with
	// SELF_REFERENTIAL_CREDENTIAL. Values are normalised (scheme+host+path,
	// trailing slash stripped) before comparison.
	SelfOrigins []string
	// Logger is used for structured logging; never logs secret material. When
	// nil, slog.Default is used.
	Logger *slog.Logger
}

// New constructs an EliteaAccount from cfg.
func New(cfg Config) (*EliteaAccount, error) {
	if cfg.DB == nil {
		return nil, errors.New("account: DB is required")
	}
	if cfg.Vault == nil {
		return nil, errors.New("account: Vault is required")
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	origins := make(map[string]struct{}, len(cfg.SelfOrigins))
	for _, o := range cfg.SelfOrigins {
		if n := normaliseOrigin(o); n != "" {
			origins[n] = struct{}{}
		}
	}
	return &EliteaAccount{
		db:                  cfg.DB,
		vault:               cfg.Vault,
		providerConcurrency: cfg.ProviderConcurrency,
		selfOrigins:         origins,
		logger:              logger,
	}, nil
}

// GetConfiguredProviders returns the static supported-provider set. Per-project
// availability is enforced in GetKeysForProvider (which returns zero keys for a
// provider a project has not configured), so this list does not depend on any
// project and needs no context (matching the interface, which supplies none).
func (a *EliteaAccount) GetConfiguredProviders() ([]schemas.ModelProvider, error) {
	out := make([]schemas.ModelProvider, len(supportedProviders))
	copy(out, supportedProviders)
	return out, nil
}

// GetConfigForProvider returns the per-provider ProviderConfig. The interface
// supplies no context, so this cannot vary by project; it carries only the
// tuned-down concurrency (§9.5). bifrost/core fills the remaining defaults via
// ProviderConfig.CheckAndSetDefaults. Per-project endpoints (api_base) are
// delivered per request through GetKeysForProvider's key configs, not here.
func (a *EliteaAccount) GetConfigForProvider(schemas.ModelProvider) (*schemas.ProviderConfig, error) {
	return &schemas.ProviderConfig{
		ConcurrencyAndBufferSize: schemas.ConcurrencyAndBufferSize{
			Concurrency: a.providerConcurrency,
		},
	}, nil
}

// GetKeysForProvider resolves the calling project's credentials for provider,
// reading them from the Fernet vault per request. It never returns raw key
// material to anywhere but bifrost/core's in-memory schemas.Key.
//
// The projectID is taken from BifrostContextKeyVirtualKey, which the /llm
// handler sets to the resolved project id from the signed X-Elitea-Project-Id
// header (design §5.3). With no project in context there is nothing to resolve
// and zero keys are returned (core treats this as "no key for provider").
func (a *EliteaAccount) GetKeysForProvider(ctx context.Context, provider schemas.ModelProvider) ([]schemas.Key, error) {
	projectID := projectIDFromContext(ctx)
	if projectID == "" {
		return []schemas.Key{}, nil
	}

	creds, err := a.loadCredentials(ctx, projectID, provider)
	if err != nil {
		return nil, fmt.Errorf("account: load credentials for project %s provider %s: %w", projectID, provider, err)
	}

	keys := make([]schemas.Key, 0, len(creds))
	for _, c := range creds {
		// Self-referential guard: reject any credential pointing back at the
		// platform's own /llm origin before its secret is ever resolved.
		if a.isSelfReferential(c.apiBase) {
			a.logger.WarnContext(ctx, "rejected self-referential provider credential",
				"reason", SelfReferentialCredentialReason,
				"project_id", projectID,
				"provider", string(provider),
				"config_id", c.configID,
			)
			return nil, fmt.Errorf("account: credential %s: %w", c.configID, ErrSelfReferentialCredential)
		}

		apiKey, err := a.vault.Resolve(ctx, projectID, c.apiKeyRef)
		if err != nil {
			return nil, fmt.Errorf("account: resolve secret for credential %s: %w", c.configID, err)
		}

		keys = append(keys, buildKey(provider, c, apiKey))
	}
	return keys, nil
}

// buildKey assembles a schemas.Key for a resolved credential. For providers whose
// endpoint is carried per key (Ollama, Vertex-style URL providers), the api_base
// is threaded into the provider-specific key config; for the OpenAI-compatible
// providers the base URL is applied by the /llm handler when it builds the core
// request (BF0.3), so the key carries only the resolved secret value.
func buildKey(provider schemas.ModelProvider, c credential, apiKey string) schemas.Key {
	key := schemas.Key{
		ID:     c.configID,
		Name:   c.name,
		Value:  *schemas.NewSecretVar(apiKey),
		Models: schemas.WhiteList{"*"},
	}
	switch provider {
	case schemas.Ollama:
		if c.apiBase != "" {
			key.OllamaKeyConfig = &schemas.OllamaKeyConfig{URL: *schemas.NewSecretVar(c.apiBase)}
		}
	case schemas.Azure:
		if c.apiBase != "" {
			key.AzureKeyConfig = &schemas.AzureKeyConfig{Endpoint: *schemas.NewSecretVar(c.apiBase)}
		}
	}
	return key
}

// isSelfReferential reports whether apiBase points at the platform's own /llm
// origin. Comparison uses segment-aware, case-insensitive matching on the
// normalised (scheme+host+path) origin so that partial-segment prefixes (e.g.
// credential "/llm/v" vs self "/llm/v1") do not produce false positives, and a
// credential with an uppercase path cannot evade the guard.
func (a *EliteaAccount) isSelfReferential(apiBase string) bool {
	n := normaliseOrigin(apiBase)
	if n == "" {
		return false
	}
	nLower := strings.ToLower(n)
	for self := range a.selfOrigins {
		selfLower := strings.ToLower(self)
		if nLower == selfLower {
			return true
		}
		// Reject when one is a path-segment prefix of the other so that
		// ".../llm" matches self ".../llm/v1" and ".../llm/v1/extra" also
		// matches — but ".../llm/v" does NOT match ".../llm/v1" (partial segment).
		if isSegmentPrefixOf(nLower, selfLower) || isSegmentPrefixOf(selfLower, nLower) {
			return true
		}
	}
	return false
}

// isSegmentPrefixOf reports whether prefix is a path-segment prefix of s.
// The prefix must be followed by "/" or be equal to s; this prevents a path
// component "/llm/v" from matching "/llm/v1".
func isSegmentPrefixOf(prefix, s string) bool {
	if !strings.HasPrefix(s, prefix) {
		return false
	}
	rest := s[len(prefix):]
	return rest == "" || rest[0] == '/'
}

// normaliseOrigin canonicalises a URL to scheme://host[:port]/path with any
// trailing slash removed, lowercasing scheme and host. Path case is preserved
// for the normalised form; isSelfReferential applies case-insensitive comparison
// at match time so that uppercase paths cannot evade the guard. Non-URL or empty
// input yields "".
//
// Fix #4: normalisation also strips:
//   - A trailing dot from FQDN hostnames (e.g. "host." → "host") so that
//     "https://host./path" and "https://host/path" compare equal.
//   - Explicit default ports that are semantically a no-op: :443 for HTTPS and
//     :80 for HTTP, so "https://host:443/path" and "https://host/path" match.
func normaliseOrigin(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	scheme := strings.ToLower(u.Scheme)

	// Separate host and port so we can normalise each independently.
	hostname := u.Hostname()
	portStr := u.Port()

	// Strip trailing dot from FQDN (RFC 1034 § 3.1: "host." == "host").
	hostname = strings.TrimSuffix(hostname, ".")
	hostname = strings.ToLower(hostname)

	// Drop explicit default ports so "https://host:443" == "https://host".
	isDefaultPort := (scheme == "https" && portStr == "443") ||
		(scheme == "http" && portStr == "80")
	var host string
	if portStr == "" || isDefaultPort {
		host = hostname
	} else {
		host = net.JoinHostPort(hostname, portStr)
	}

	path := strings.TrimRight(u.Path, "/")
	return scheme + "://" + host + path
}

// projectIDFromContext extracts the resolved projectID the /llm handler stashed
// under BifrostContextKeyVirtualKey. Returns "" when absent or not a string.
func projectIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if v, ok := ctx.Value(schemas.BifrostContextKeyVirtualKey).(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}
