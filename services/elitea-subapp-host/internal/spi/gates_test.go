package spi_test

import (
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-subapp-host/internal/apps/echo"
	"github.com/EliteaAI/elitea-platform/services/elitea-subapp-host/internal/spi"
)

// The two gates in front of the SPI — mutual TLS, then identity — with the
// refusals the facade parses: 421 for a cleartext hop, 496 for a TLS hop
// with no verified client certificate, 401 for a missing or invalid identity
// signature. The probes bypass both, so a rotation does not empty the
// moment mTLS goes on.

func gated(t *testing.T, pairs map[string]string) *spi.Server {
	t.Helper()
	base := map[string]string{"ELITEA_ECHO_IDENTITY_SECRET": "shared-with-the-provider"}
	for k, v := range pairs {
		base[k] = v
	}
	s, err := spi.SettingsFromEnv("ELITEA_ECHO_", env(base))
	if err != nil {
		t.Fatal(err)
	}
	server, err := spi.NewServer(s, echo.App(0), nil)
	if err != nil {
		t.Fatal(err)
	}
	return server
}

func mtlsSettings() map[string]string {
	return map[string]string{"ELITEA_ECHO_TLS_CERTFILE": "/c", "ELITEA_ECHO_TLS_KEYFILE": "/k", "ELITEA_ECHO_TLS_CA_FILE": "/ca"}
}

func signed(method, path string) *http.Request {
	r := httptest.NewRequest(method, path, nil)
	spi.SignHeaders(r.Header, spi.Identity{ProjectID: "1", UserID: "7"}, []byte("shared-with-the-provider"))
	return r
}

func overTLS(r *http.Request, verified bool) *http.Request {
	r.TLS = &tls.ConnectionState{}
	if verified {
		r.TLS.VerifiedChains = [][]*x509.Certificate{{{}}}
	}
	return r
}

func serve(h http.Handler, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestACleartextHopIsMisdirectedWhenMTLSIsRequired(t *testing.T) {
	h := gated(t, mtlsSettings())
	if w := serve(h, signed(http.MethodGet, "/slots")); w.Code != http.StatusMisdirectedRequest {
		t.Fatalf("cleartext /slots: %d %s", w.Code, w.Body.String())
	}
	for _, probe := range []string{"/health", "/ready"} {
		if w := serve(h, httptest.NewRequest(http.MethodGet, probe, nil)); w.Code != http.StatusOK {
			t.Fatalf("cleartext %s must stay reachable: %d", probe, w.Code)
		}
	}
}

// A TLS hop whose client certificate the listener did not verify is 496 —
// unless THIS process is the terminus, in which case the handshake already
// required and verified one and the request could not have arrived without
// it. Both facts hold at once in production; the first matters for a host
// behind a TLS-terminating proxy that verifies nothing.
func TestATLSHopNeedsAVerifiedClientCertificateUnlessTheHostIsTheTerminus(t *testing.T) {
	terminus := gated(t, mtlsSettings())
	if w := serve(terminus, overTLS(signed(http.MethodGet, "/slots"), false)); w.Code != http.StatusOK {
		t.Fatalf("the terminus refused its own handshake: %d %s", w.Code, w.Body.String())
	}
	// A CA alone is not a terminus (the listener elsewhere terminated TLS).
	s, err := spi.SettingsFromEnv("ELITEA_ECHO_", env(map[string]string{"ELITEA_ECHO_IDENTITY_SECRET": "shared-with-the-provider"}))
	if err != nil {
		t.Fatal(err)
	}
	s.TLSCAFile = "/ca" // required, not terminating
	fronted, err := spi.NewServer(s, echo.App(0), nil)
	if err != nil {
		t.Fatal(err)
	}
	if w := serve(fronted, overTLS(signed(http.MethodGet, "/slots"), false)); w.Code != 496 {
		t.Fatalf("no verified chain behind a proxy: %d", w.Code)
	}
	if w := serve(fronted, overTLS(signed(http.MethodGet, "/slots"), true)); w.Code != http.StatusOK {
		t.Fatalf("a verified chain was refused: %d %s", w.Code, w.Body.String())
	}
}

func TestIdentityIsVerifiedWhenASecretIsSharedAndDroppedWhenNot(t *testing.T) {
	h := gated(t, mtlsSettings())
	// Valid signature: served.
	if w := serve(h, overTLS(signed(http.MethodGet, "/slots"), true)); w.Code != http.StatusOK {
		t.Fatalf("a signed hop was refused: %d %s", w.Code, w.Body.String())
	}
	// No signature at all: 401.
	if w := serve(h, overTLS(httptest.NewRequest(http.MethodGet, "/slots", nil), true)); w.Code != http.StatusUnauthorized {
		t.Fatalf("an unsigned hop was served: %d", w.Code)
	}
	// A forged project id under a valid signature for another: 401.
	r := signed(http.MethodGet, "/slots")
	r.Header.Set(spi.HeaderProjectID, "999")
	if w := serve(h, overTLS(r, true)); w.Code != http.StatusUnauthorized {
		t.Fatalf("a forged project id was served: %d", w.Code)
	}
	// Without mTLS (a dev stack) unverified headers are dropped, not refused.
	dev := gated(t, nil)
	r = httptest.NewRequest(http.MethodGet, "/slots", nil)
	r.Header.Set(spi.HeaderProjectID, "999")
	if w := serve(dev, r); w.Code != http.StatusOK {
		t.Fatalf("a dev-stack hop with stray headers was refused: %d", w.Code)
	}
}
