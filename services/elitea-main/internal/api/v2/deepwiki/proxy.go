package deepwiki

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/tenant"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/llmproxy"
)

// ErrInvalidProxy reports a proxy that cannot be constructed.
var ErrInvalidProxy = errors.New("invalid DeepWiki proxy")

// Proxy forwards a facade request to the provider service over mTLS.
type Proxy struct {
	reverse        *httputil.ReverseProxy
	identitySecret []byte
	logger         *slog.Logger
}

// NewProxy builds the mTLS hop to the provider.
//
// Transport comes from llmproxy.NewMTLSTransport — the same builder the /llm
// hop uses — rather than a second one assembled here. Two transports would be
// two places to get the CA wrong.
func NewProxy(cfg Config, logger *slog.Logger) (*Proxy, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if !cfg.Enabled {
		return nil, fmt.Errorf("%w: not enabled", ErrInvalidProxy)
	}
	if logger == nil {
		logger = slog.Default()
	}

	target, err := url.Parse(cfg.BaseURL)
	if err != nil || target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("%w: %s must be an absolute URL, got %q",
			ErrInvalidProxy, BaseURLEnv, cfg.BaseURL)
	}
	if target.Scheme != "https" {
		// The provider refuses non-mTLS traffic, so a plain-HTTP base URL
		// produces a facade that 502s on every call. Catch it at startup.
		return nil, fmt.Errorf("%w: %s must be https, got %q",
			ErrInvalidProxy, BaseURLEnv, cfg.BaseURL)
	}

	serverName := cfg.ServerName
	if serverName == "" {
		serverName = target.Hostname()
	}

	transport, err := llmproxy.NewMTLSTransport(
		cfg.ClientCertFile, cfg.ClientKeyFile, cfg.CAFile, serverName)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrInvalidProxy, err)
	}

	reverse := &httputil.ReverseProxy{
		Transport: transport,
		// Negative flushes to the client after every write. Poll responses are
		// small, but a generation's terminal result is not, and buffering it
		// would add latency to the one call a user is actually waiting on.
		FlushInterval: -1,
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			// The provider is addressed by its own name. Rewrite — unlike the
			// older Director — hands over an outbound request whose Host is
			// already cleared, so the transport uses the target URL's host and
			// the caller's Host never travels. Nothing is assigned here for
			// exactly that reason: an assignment would read as load-bearing
			// while changing nothing. The route test pins the resulting
			// behaviour, so re-forwarding the inbound Host later fails rather
			// than quietly handing a peer a hostname it does not serve.
			pr.SetXForwarded()
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			logger.Error("deepwiki proxy failed",
				"path", r.URL.Path, "error", err)
			writeError(w, http.StatusServiceUnavailable,
				"The DeepWiki service is unreachable.")
		},
	}

	return &Proxy{
		reverse:        reverse,
		identitySecret: []byte(cfg.IdentitySecret),
		logger:         logger,
	}, nil
}

// Forward proxies the request to providerPath, signing the caller's identity.
//
// The identity is resolved by this service and signed here; whatever the
// client sent is dropped by SignIdentityHeaders before the signed values are
// written. The provider strips them again on arrival, so a spoofed header
// would have to survive two independent removals.
func (p *Proxy) Forward(
	w http.ResponseWriter,
	r *http.Request,
	providerPath string,
	projectID string,
	userID string,
) {
	if p == nil || p.reverse == nil {
		writeError(w, http.StatusServiceUnavailable, "DeepWiki is not enabled.")
		return
	}

	outbound := r.Clone(r.Context())
	outbound.URL.Path = providerPath
	outbound.URL.RawPath = ""

	// X-Secret is the legacy pylon shared-secret header. SignIdentityHeaders
	// below already removes Authorization, Cookie, X-Api-Key and the
	// X-Auth-* forward-auth headers — the provider authenticates the HOP, not
	// the end user, and has no use for a platform credential — but that list
	// is the /llm hop's and does not know about this one. Deleted here rather
	// than added there: a header this facade's peer once honoured is this
	// facade's problem, and widening the shared stripper would change what the
	// gateway forwards too.
	outbound.Header.Del("X-Secret")

	// The tenant is part of the canonical string both sides sign, so it must
	// travel even though this facade never reads it: signing it as empty when
	// the request carries one would produce a signature the provider computes
	// differently and rejects.
	tenantID, _ := tenant.TenantFromContext(r.Context())

	llmproxy.SignIdentityHeaders(
		outbound.Header, p.identitySecret, projectID, userID, tenantID, "")

	p.reverse.ServeHTTP(w, outbound)
}

// providerInvokePath builds the provider's invoke path.
//
// The provider's paths carry the toolkit and tool segments — that is its wire
// contract and the form its SPI OpenAPI declares — so the facade's own path
// carries them too and they map across one-for-one.
func providerInvokePath(toolkit, tool string) string {
	return fmt.Sprintf("/tools/%s/%s/invoke",
		url.PathEscape(toolkit), url.PathEscape(tool))
}

func providerInvocationPath(toolkit, tool, invocation string) string {
	return fmt.Sprintf("/tools/%s/%s/invocations/%s",
		url.PathEscape(toolkit), url.PathEscape(tool), url.PathEscape(invocation))
}

const providerSlotsPath = "/slots"

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	// The platform's general error shape, not the provider's errorCode
	// envelope: a caller of THIS API reads elitea-main's conventions.
	_, _ = w.Write([]byte(`{"error":` + quoteJSON(message) + `}`))
}

func quoteJSON(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(&b, `\u%04x`, r)
				continue
			}
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}
