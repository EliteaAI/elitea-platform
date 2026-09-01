// Package proxy is the mTLS hop from elitea-main to a provider service.
//
// Extracted in P1.5 with two callers: the DeepWiki facade and the Inventory
// facade. It is the ReverseProxy ASSEMBLY that ADR-0012 named — the transport
// and the signer already live in llmproxy and are already shared three ways.
//
// WHAT A CALLER STILL OWNS. Which headers to strip beyond the signed set,
// what to do with the body, and what its own routes are. DeepWiki deletes
// X-Secret because a header its peer once honoured is its problem; Inventory
// has no such header. Pulling that in would make the shared hop carry one
// provider's history.
package proxy

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httputil"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/tenant"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/llmproxy"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/facade"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/hop"
)

// Proxy forwards a facade request to a provider over mTLS.
type Proxy struct {
	reverse        *httputil.ReverseProxy
	identitySecret []byte
	logger         *slog.Logger
}

// New builds the hop. envName names the setting that carries the base URL, so
// a refusal says which variable an operator must fix.
func New(cfg facade.Config, envName string, logger *slog.Logger) (*Proxy, error) {
	if logger == nil {
		logger = slog.Default()
	}
	// RequireTLS: a provider refuses non-mTLS traffic, so a plain-HTTP base URL
	// is a facade that 502s on every call. Caught at startup.
	target, err := hop.ParseTarget(cfg.BaseURL, hop.TargetOptions{EnvName: envName, RequireTLS: true})
	if err != nil {
		return nil, err
	}
	serverName := cfg.ServerName
	if serverName == "" {
		serverName = target.Hostname()
	}
	transport, err := llmproxy.NewMTLSTransport(
		cfg.ClientCertFile, cfg.ClientKeyFile, cfg.CAFile, serverName)
	if err != nil {
		return nil, fmt.Errorf("build provider mTLS transport: %w", err)
	}

	reverse := &httputil.ReverseProxy{
		Transport: transport,
		// Negative flushes after every write. A poll is small; a generation's
		// terminal result is not, and buffering it adds latency to the one
		// call a user is waiting on.
		FlushInterval: -1,
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			// Rewrite hands over an outbound request whose Host is already
			// cleared, so the caller's Host never travels. Nothing is assigned
			// here for exactly that reason.
			pr.SetXForwarded()
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			logger.Error("provider proxy failed", "path", r.URL.Path, "error", err)
			http.Error(w, "The provider service is unreachable.", http.StatusServiceUnavailable)
		},
	}
	return &Proxy{reverse: reverse, identitySecret: []byte(cfg.IdentitySecret), logger: logger}, nil
}

// Forward proxies to providerPath, signing the caller's identity.
//
// Whatever the client sent is dropped by SignIdentityHeaders before the signed
// values are written, and the provider strips them again on arrival — a
// spoofed header would have to survive two independent removals.
func (p *Proxy) Forward(
	w http.ResponseWriter, r *http.Request, providerPath, projectID, userID string,
) {
	if p == nil || p.reverse == nil {
		http.Error(w, "This provider is not enabled.", http.StatusServiceUnavailable)
		return
	}
	outbound := r.Clone(r.Context())
	outbound.URL.Path = providerPath
	outbound.URL.RawPath = ""

	// The tenant is part of the canonical string both sides sign, so it must
	// travel even though this facade never reads it.
	tenantID, _ := tenant.TenantFromContext(r.Context())
	llmproxy.SignIdentityHeaders(outbound.Header, p.identitySecret, projectID, userID, tenantID, "")

	// Latent today — no server here sets a WriteTimeout — and called so that
	// adding one later cannot truncate one hop's responses and not another's.
	hop.ClearWriteDeadline(w, p.logger)
	p.reverse.ServeHTTP(w, outbound)
}
