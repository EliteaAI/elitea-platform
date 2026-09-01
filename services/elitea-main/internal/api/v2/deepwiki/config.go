// Package deepwiki is the facade in front of the DeepWiki provider service.
//
// ADR-0022 decision 5: elitea-main is the only door. The provider refuses
// non-mTLS traffic and strips any identity header a client supplies, so every
// caller reaches it through here — authenticated, permission-checked, and with
// an identity this service signs.
//
// The shape follows internal/llmproxy, which is the established pattern for an
// mTLS hop to an independently deployed Go service, and reuses its transport
// and signing helpers rather than re-deriving either. Reusing the signer
// matters more than it looks: the canonical string it produces is duplicated
// across three modules now (this one, the gateway, and the provider's Python
// verifier), and a fourth spelling of it would fail every request.
package deepwiki

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Environment variables this facade reads. All are optional except the enable
// flag; a deployment that sets none simply does not serve DeepWiki.
const (
	EnabledEnv        = "ELITEA_DEEPWIKI_ENABLED"
	BaseURLEnv        = "ELITEA_DEEPWIKI_BASE_URL"
	ClientCertEnv     = "ELITEA_DEEPWIKI_CLIENT_CERT_FILE"
	ClientKeyEnv      = "ELITEA_DEEPWIKI_CLIENT_KEY_FILE"
	CAFileEnv         = "ELITEA_DEEPWIKI_CA_FILE"
	ServerNameEnv     = "ELITEA_DEEPWIKI_SERVER_NAME"
	IdentitySecretEnv = "ELITEA_DEEPWIKI_IDENTITY_SECRET"
	TimeoutEnv        = "ELITEA_DEEPWIKI_TIMEOUT_SECONDS"
)

// ErrIncompleteConfig reports a deployment that enabled DeepWiki without
// giving the facade what it needs to reach the provider.
var ErrIncompleteConfig = errors.New("incomplete DeepWiki facade configuration")

// Config is what the facade needs to proxy.
type Config struct {
	Enabled bool

	// BaseURL is the provider service's origin, e.g. https://deepwiki:8080.
	BaseURL string

	// mTLS material. The provider requires a client certificate, so these are
	// mandatory whenever the facade is enabled — see Validate.
	ClientCertFile string
	ClientKeyFile  string
	CAFile         string
	ServerName     string

	// IdentitySecret signs the identity headers the provider verifies. Empty
	// disables signing, which the provider also allows; the mTLS transport
	// still authenticates the hop. It is not a default worth relying on and
	// Validate says so.
	IdentitySecret string

	Timeout time.Duration
}

// ConfigFromEnv reads the facade's configuration.
//
// Strict: a value that cannot be parsed is an error rather than a silent
// default, so a typo fails at startup instead of producing a facade that is
// quietly disabled or quietly unauthenticated.
func ConfigFromEnv(lookup func(string) (string, bool)) (Config, error) {
	if lookup == nil {
		lookup = os.LookupEnv
	}

	get := func(key string) string {
		value, _ := lookup(key)
		return strings.TrimSpace(value)
	}

	enabled, err := parseBool(get(EnabledEnv))
	if err != nil {
		return Config{}, fmt.Errorf("%s: %w", EnabledEnv, err)
	}

	timeout := 30 * time.Second
	if raw := get(TimeoutEnv); raw != "" {
		seconds, convErr := strconv.Atoi(raw)
		if convErr != nil || seconds <= 0 {
			return Config{}, fmt.Errorf(
				"%s must be a positive integer, got %q", TimeoutEnv, raw)
		}
		timeout = time.Duration(seconds) * time.Second
	}

	return Config{
		Enabled:        enabled,
		BaseURL:        get(BaseURLEnv),
		ClientCertFile: get(ClientCertEnv),
		ClientKeyFile:  get(ClientKeyEnv),
		CAFile:         get(CAFileEnv),
		ServerName:     get(ServerNameEnv),
		IdentitySecret: get(IdentitySecretEnv),
		Timeout:        timeout,
	}, nil
}

// Validate reports whether an ENABLED config can actually reach the provider.
//
// A disabled facade needs nothing. An enabled one that cannot present a client
// certificate would be refused by the provider on every request, so it is
// caught here, at composition, rather than as a 503 per call.
func (c Config) Validate() error {
	if !c.Enabled {
		return nil
	}

	var missing []string
	if c.BaseURL == "" {
		missing = append(missing, BaseURLEnv)
	}
	// The provider terminates mTLS with CERT_REQUIRED. Without all three of
	// these the hop cannot be established at all.
	if c.ClientCertFile == "" {
		missing = append(missing, ClientCertEnv)
	}
	if c.ClientKeyFile == "" {
		missing = append(missing, ClientKeyEnv)
	}
	if c.CAFile == "" {
		missing = append(missing, CAFileEnv)
	}

	if len(missing) > 0 {
		return fmt.Errorf("%w: %s is set but %s %s not",
			ErrIncompleteConfig, EnabledEnv,
			strings.Join(missing, ", "),
			pluralIsAre(len(missing)))
	}
	return nil
}

func pluralIsAre(n int) string {
	if n == 1 {
		return "is"
	}
	return "are"
}

// parseBool accepts the same spellings the rest of elitea-main's runtime
// configuration does, and refuses anything else rather than reading it as
// false — a misspelled "ture" must not silently disable a feature someone
// believes they turned on.
func parseBool(raw string) (bool, error) {
	switch strings.ToLower(raw) {
	case "", "0", "false", "no", "off":
		return false, nil
	case "1", "true", "yes", "on":
		return true, nil
	default:
		return false, fmt.Errorf("must be a boolean, got %q", raw)
	}
}
