package deepwiki

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/facade"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/proxy"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/spi"
)

// ErrInvalidProxy is returned for a configuration the hop cannot be built from.
var ErrInvalidProxy = errors.New("invalid DeepWiki proxy")

// Proxy is the facade's hop to the provider: providerhost/proxy, which now
// carries what this package used to fork it for — the upstream status the
// invoke path reads to revoke a refused invocation's callback grant, and the
// X-Secret strip. Kept as a type so the callers and the tests that name it
// stay put; every behaviour is the shared package's.
type Proxy struct {
	hop *proxy.Proxy
}

// NewProxy builds the hop from the facade's configuration.
func NewProxy(cfg Config, logger *slog.Logger) (*Proxy, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if !cfg.Enabled {
		return nil, fmt.Errorf("%w: not enabled", ErrInvalidProxy)
	}
	hop, err := proxy.New(cfg.hop(), BaseURLEnv, logger)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrInvalidProxy, err)
	}
	return &Proxy{hop: hop}, nil
}

// Forward proxies one request to the provider path, signed for the caller.
func (p *Proxy) Forward(
	w http.ResponseWriter,
	r *http.Request,
	providerPath string,
	projectID string,
	userID string,
) {
	if p == nil || p.hop == nil {
		writeError(w, http.StatusServiceUnavailable, "DeepWiki is not enabled.")
		return
	}
	p.hop.Forward(w, r, providerPath, projectID, userID)
}

// ForwardObserved is Forward that also reports the provider's status — 0
// when the provider was never reached. The invoke path revokes the callback
// grant it minted when the provider refused the invocation; without the
// status it could only guess.
func (p *Proxy) ForwardObserved(
	w http.ResponseWriter,
	r *http.Request,
	providerPath string,
	projectID string,
	userID string,
) int {
	outcome := &proxy.Outcome{}
	p.Forward(w, r.WithContext(proxy.WithOutcome(r.Context(), outcome)), providerPath, projectID, userID)
	return outcome.Status
}

// hop is the shared facade configuration this one carries; the DeepWiki
// extras (callback base, token lifetime, git egress) stay on the facade.
func (c Config) hop() facade.Config {
	return facade.Config{
		Enabled:        c.Enabled,
		BaseURL:        c.BaseURL,
		ClientCertFile: c.ClientCertFile,
		ClientKeyFile:  c.ClientKeyFile,
		CAFile:         c.CAFile,
		ServerName:     c.ServerName,
		IdentitySecret: c.IdentitySecret,
		Timeout:        c.Timeout,
	}
}

// The SPI paths. The invoke override forwards to the first; the other two
// are the shared table's business now, and are named here only so the SPI
// contract parity test can pin all three against the frozen contract.
var (
	providerInvokePath     = spi.InvokePath
	providerInvocationPath = spi.InvocationPath
)

const providerSlotsPath = spi.SlotsPath

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
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
