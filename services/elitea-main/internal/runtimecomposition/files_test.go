package runtimecomposition

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadPasswordUsesExactBoundedCrossLanguageContract(t *testing.T) {
	tests := []struct {
		name string
		raw  []byte
		want []byte
	}{
		{name: "empty", raw: nil},
		{name: "512 bytes", raw: bytes.Repeat([]byte("a"), 512), want: bytes.Repeat([]byte("a"), 512)},
		{name: "513 bytes", raw: bytes.Repeat([]byte("a"), 513)},
		{name: "515 raw bytes", raw: bytes.Repeat([]byte("a"), 515)},
		{name: "terminal LF", raw: []byte("password\n"), want: []byte("password")},
		{name: "512 bytes and terminal LF", raw: append(bytes.Repeat([]byte("b"), 512), '\n'), want: bytes.Repeat([]byte("b"), 512)},
		{name: "512 bytes and terminal CRLF", raw: append(bytes.Repeat([]byte("c"), 512), '\r', '\n'), want: bytes.Repeat([]byte("c"), 512)},
		{name: "embedded LF", raw: []byte("pass\nword")},
		{name: "repeated terminal LF", raw: []byte("password\n\n")},
		{name: "lone terminal CR", raw: []byte("password\r")},
		{name: "NUL", raw: []byte("pass\x00word")},
		{name: "invalid UTF-8", raw: []byte{0xff}},
		{name: "UTF-8 bytes preserved", raw: []byte("pässwörd\r\n"), want: []byte("pässwörd")},
		{name: "spaces preserved", raw: []byte(" password \r\n"), want: []byte(" password ")},
	}

	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(root, test.name)
			if err := os.WriteFile(path, test.raw, 0o600); err != nil {
				t.Fatal(err)
			}
			password, err := loadPassword(path)
			if test.want == nil {
				if err == nil {
					t.Fatalf("loadPassword() = %q, want error", password)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal([]byte(password), test.want) {
				t.Fatalf("loadPassword() bytes = %x, want %x", []byte(password), test.want)
			}
		})
	}
}

func TestLoadPasswordRequiresOwnerOnlyRegularFile(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "redis-password")
	if err := os.WriteFile(path, []byte("password"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o640); err != nil {
		t.Fatal(err)
	}
	if _, err := loadPassword(path); err == nil {
		t.Fatal("group-readable Redis password file was accepted")
	}
}

func TestLoadOptionalFernetMasterKeyUsesBoundedPrivateFile(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if value, err := loadOptionalFernetMasterKey(""); err != nil || value != nil {
		t.Fatalf("absent optional key = %x, %v", value, err)
	}

	encoded := []byte(base64.URLEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)))
	path := filepath.Join(root, "vault-master-key")
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadOptionalFernetMasterKey(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(loaded, encoded) {
		t.Fatalf("loaded Fernet key changed: %x", loaded)
	}
	clear(loaded)

	if err := os.WriteFile(path, []byte("not-a-fernet-key"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadOptionalFernetMasterKey(path); err == nil {
		t.Fatal("malformed Fernet key was accepted")
	}
	if err := os.WriteFile(path, encoded, 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o640); err != nil {
		t.Fatal(err)
	}
	if _, err := loadOptionalFernetMasterKey(path); err == nil {
		t.Fatal("group-readable Fernet key was accepted")
	}
}

func TestLoadEd25519PrivateKeyAcceptsOnlyBoundedPKCS8File(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "signing-key.pem")
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}), 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := loadEd25519PrivateKey(path)
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.Equal(privateKey) {
		t.Fatal("loaded signing key changed")
	}

	oversize := filepath.Join(root, "oversize.pem")
	if err := os.WriteFile(oversize, make([]byte, maxSigningKeyFileBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadEd25519PrivateKey(oversize); err == nil {
		t.Fatal("oversize signing key file was accepted")
	}
}

func TestLoadRedisRootsUsesOnlyConfiguredTrustAnchor(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "runtime redis test CA"},
		NotBefore:             time.Now().Add(-time.Minute),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, publicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	certificatePEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	path := filepath.Join(root, "redis-ca.pem")
	if err := os.WriteFile(path, certificatePEM, 0o644); err != nil {
		t.Fatal(err)
	}
	roots, err := loadRedisRoots(path)
	if err != nil {
		t.Fatal(err)
	}
	expectedRoots := x509.NewCertPool()
	if !expectedRoots.AppendCertsFromPEM(certificatePEM) {
		t.Fatal("test Redis CA PEM was not accepted")
	}
	if !roots.Equal(expectedRoots) {
		t.Fatal("Redis trust roots do not contain exactly the configured CA")
	}
}
