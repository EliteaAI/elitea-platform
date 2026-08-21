package server

// tls_alpn_test.go — the listener must advertise http/1.1 and nothing else.
//
// This is a correctness requirement of the realtime WebSocket route, not a
// tuning choice. ListenAndServeTLS adds "h2" to NextProtos when the field is
// empty, so the listener negotiated HTTP/2 with any client that offered it. A
// WebSocket upgrade needs the raw connection, and net/http gets it by hijacking
// the ResponseWriter — but an HTTP/2 ResponseWriter serves one stream of a
// multiplexed connection and is not an http.Hijacker. The upgrade then failed
// deep inside the accept, with an opaque error, after the caller believed the
// handshake had started.
//
// Production survived only because elitea-main's proxy transport pins http/1.1.
// A direct in-cluster h2 client did not.

import (
	"crypto/tls"
	"os"
	"path/filepath"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/config"
)

func TestBuildTLSConfig_AdvertisesHTTP11Only(t *testing.T) {
	cfg := config.Config{TLSCertFile: "cert.pem", TLSKeyFile: "key.pem"}
	tlsCfg, err := buildTLSConfig(cfg)
	if err != nil {
		t.Fatalf("buildTLSConfig: %v", err)
	}
	if len(tlsCfg.NextProtos) != 1 || tlsCfg.NextProtos[0] != "http/1.1" {
		t.Fatalf("NextProtos = %v, want [http/1.1]: an empty list lets ListenAndServeTLS add h2, "+
			"and an HTTP/2 ResponseWriter cannot be hijacked for a WebSocket upgrade", tlsCfg.NextProtos)
	}
	for _, p := range tlsCfg.NextProtos {
		if p == "h2" {
			t.Fatal("the listener advertises h2; the realtime route cannot hijack an HTTP/2 stream")
		}
	}
}

// TestBuildTLSConfig_KeepsTheMTLSContract holds the rest of the profile in place
// so the ALPN change above cannot quietly relax the client-certificate rule
// alongside it.
func TestBuildTLSConfig_KeepsTheMTLSContract(t *testing.T) {
	dir := t.TempDir()
	ca := filepath.Join(dir, "ca.pem")
	if err := os.WriteFile(ca, []byte(testCAPEM), 0o600); err != nil {
		t.Fatalf("write the CA file: %v", err)
	}
	tlsCfg, err := buildTLSConfig(config.Config{
		TLSCertFile: "cert.pem", TLSKeyFile: "key.pem", TLSCAFile: ca,
	})
	if err != nil {
		t.Fatalf("buildTLSConfig: %v", err)
	}
	if tlsCfg.ClientAuth != tls.RequireAndVerifyClientCert {
		t.Errorf("ClientAuth = %v, want RequireAndVerifyClientCert", tlsCfg.ClientAuth)
	}
	if tlsCfg.MinVersion != tls.VersionTLS12 {
		t.Errorf("MinVersion = %x, want TLS 1.2", tlsCfg.MinVersion)
	}
	if len(tlsCfg.NextProtos) != 1 || tlsCfg.NextProtos[0] != "http/1.1" {
		t.Errorf("NextProtos = %v, want [http/1.1] on the mTLS path too", tlsCfg.NextProtos)
	}
}

// testCAPEM is a throwaway self-signed certificate. It is only ever parsed as a
// CA bundle; nothing signs or verifies with it.
const testCAPEM = `-----BEGIN CERTIFICATE-----
MIIBhTCCASugAwIBAgIQIRi6zePL6mKjOipn+dNuaTAKBggqhkjOPQQDAjASMRAw
DgYDVQQKEwdBY21lIENvMB4XDTE3MTAyMDE5NDMwNloXDTE4MTAyMDE5NDMwNlow
EjEQMA4GA1UEChMHQWNtZSBDbzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABD0d
7VNhbWvZLWPuj/RtHFjvtJBEwOkhbN/BnnE8rnZR8+sbwnc/KhCk3FhnpHZnQz7B
5aETbbIgmuvewdjvSBSjYzBhMA4GA1UdDwEB/wQEAwICpDATBgNVHSUEDDAKBggr
BgEFBQcDATAPBgNVHRMBAf8EBTADAQH/MCkGA1UdEQQiMCCCDmxvY2FsaG9zdDo1
NDUzgg4xMjcuMC4wLjE6NTQ1MzAKBggqhkjOPQQDAgNIADBFAiEA2zpJEPQyz6/l
Wf86aX6PepsntZv2GYlA5UpabfT2EZICICpJ5h/iI+i341gBmLiAFQOyTDT+/wQc
6MF9+Yw1Yy0t
-----END CERTIFICATE-----`
