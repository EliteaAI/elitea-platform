package proxy_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/facade"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/proxy"
)

// What the shared hop must do for BOTH facades — the two behaviours the
// DeepWiki facade once forked this package for (ADR-0023 H0): report the
// provider's status back to the caller, and strip the legacy X-Secret header
// so a caller's copy never reaches a provider that once honoured it. Proved
// against a real mutual-TLS server, because the hop is the mTLS assembly.

func TestForwardReportsTheProviderStatusAndStripsXSecret(t *testing.T) {
	var seen http.Header
	status := http.StatusTeapot
	cfg := mtlsProvider(t, func(w http.ResponseWriter, r *http.Request) {
		seen = r.Header.Clone()
		w.WriteHeader(status)
	})
	hop, err := proxy.New(cfg, "TEST_BASE_URL", nil)
	if err != nil {
		t.Fatalf("building the hop: %v", err)
	}

	outcome := &proxy.Outcome{}
	request := httptest.NewRequest(http.MethodGet, "/api/v2/anything/slots/1", nil)
	request.Header.Set("X-Secret", "legacy-shared-secret")
	request.Header.Set("X-Elitea-Project-Id", "999") // a caller's forgery; the signer overwrites it
	recorder := httptest.NewRecorder()
	hop.Forward(recorder, request.WithContext(proxy.WithOutcome(request.Context(), outcome)), "/slots", "1", "7")

	if recorder.Code != status {
		t.Fatalf("caller saw %d, provider answered %d", recorder.Code, status)
	}
	if outcome.Status != status {
		t.Fatalf("Outcome carried %d, provider answered %d", outcome.Status, status)
	}
	if got := seen.Get("X-Secret"); got != "" {
		t.Fatalf("X-Secret reached the provider as %q", got)
	}
	if got := seen.Get("X-Elitea-Project-Id"); got != "1" {
		t.Fatalf("the signed project id was %q, want the facade's 1", got)
	}
	if seen.Get("X-Elitea-Identity-Signature") == "" {
		t.Fatal("the hop did not sign the identity headers")
	}
}

func TestOutcomeStaysZeroWhenTheProviderIsUnreachable(t *testing.T) {
	cfg := mtlsProvider(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	cfg.BaseURL = "https://127.0.0.1:1" // nothing listens
	hop, err := proxy.New(cfg, "TEST_BASE_URL", nil)
	if err != nil {
		t.Fatalf("building the hop: %v", err)
	}
	outcome := &proxy.Outcome{}
	request := httptest.NewRequest(http.MethodGet, "/x", nil)
	recorder := httptest.NewRecorder()
	hop.Forward(recorder, request.WithContext(proxy.WithOutcome(context.Background(), outcome)), "/slots", "1", "7")
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("an unreachable provider answered %d, want 503", recorder.Code)
	}
	if outcome.Status != 0 {
		t.Fatalf("Outcome for an unreached provider was %d, want 0", outcome.Status)
	}
}

// mtlsProvider serves handler behind mutual TLS and returns a facade.Config
// whose client certificate the server trusts.
func mtlsProvider(t *testing.T, handler http.HandlerFunc) facade.Config {
	t.Helper()
	ca, caKey := authority(t, "providerhost-test-ca")
	serverCert := issue(t, ca, caKey, "provider.internal", x509.ExtKeyUsageServerAuth)
	clientCert := issue(t, ca, caKey, "elitea-main", x509.ExtKeyUsageClientAuth)
	pool := x509.NewCertPool()
	pool.AddCert(ca)
	server := httptest.NewUnstartedServer(handler)
	server.TLS = &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		ClientCAs:    pool,
		ClientAuth:   tls.RequireAndVerifyClientCert,
		MinVersion:   tls.VersionTLS12,
	}
	server.StartTLS()
	t.Cleanup(server.Close)
	dir := t.TempDir()
	certFile := filepath.Join(dir, "tls.crt")
	keyFile := filepath.Join(dir, "tls.key")
	caFile := filepath.Join(dir, "ca.crt")
	writePEM(t, certFile, "CERTIFICATE", clientCert.Certificate[0])
	key, err := x509.MarshalECPrivateKey(clientCert.PrivateKey.(*ecdsa.PrivateKey))
	if err != nil {
		t.Fatal(err)
	}
	writePEM(t, keyFile, "EC PRIVATE KEY", key)
	writePEM(t, caFile, "CERTIFICATE", ca.Raw)
	return facade.Config{
		Enabled:        true,
		BaseURL:        server.URL,
		ClientCertFile: certFile,
		ClientKeyFile:  keyFile,
		CAFile:         caFile,
		ServerName:     "provider.internal",
		IdentitySecret: "shared-with-the-provider",
		Timeout:        10 * time.Second,
	}
}

func authority(t *testing.T, name string) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: name},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return certificate, key
}

func issue(t *testing.T, ca *x509.Certificate, caKey *ecdsa.PrivateKey, name string, usage x509.ExtKeyUsage) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: name},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{usage},
		DNSNames:     []string{name},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca, &key.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func writePEM(t *testing.T, path, blockType string, der []byte) {
	t.Helper()
	encoded := pem.EncodeToMemory(&pem.Block{Type: blockType, Bytes: der})
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
}
