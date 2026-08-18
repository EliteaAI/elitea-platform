package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The mode that the kubelet gives each key of a Secret volume when the pod
// declares defaultMode 0444.
const secretVolumeMode = 0o444

// The five key names of this test's Secret. They are the basenames of the five
// paths in the authentication configuration below, which is the contract: the
// operator names the paths, and the Secret keys must match their basenames.
var materialKeys = []string{
	"redis-auth-password",
	"auth-redis-ca.crt",
	"auth-attempt-key",
	"auth-pat-signing-key",
	"auth-form-users.json",
}

func TestInstallMakesASecretVolumeReadableByTheAuthenticationPlane(t *testing.T) {
	pod := newPod(t)

	var stdout, stderr bytes.Buffer
	code := run([]string{
		"-config", pod.configuration,
		"-source", pod.source,
		"-mount", pod.material,
	}, &stdout, &stderr)
	if code != exitInstalled {
		t.Fatalf("exit code = %d, stderr = %q", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), fmt.Sprintf("%d files installed", len(materialKeys))) {
		t.Fatalf("unexpected report: %q", stdout.String())
	}

	for _, name := range materialKeys {
		path := filepath.Join(pod.material, name)
		info, err := os.Lstat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("%s carries mode %o, and the copies must be owner-only", name, info.Mode().Perm())
		}
	}
}

// TestInstallRefusesAMountThatTheConfigurationDoesNotName is the check that
// the chart needs. The chart states the directory; the operator's
// authentication document states the five paths. Nothing else compares them.
func TestInstallRefusesAMountThatTheConfigurationDoesNotName(t *testing.T) {
	pod := newPod(t)
	elsewhere := filepath.Join(filepath.Dir(pod.material), "somewhere-else")
	if err := os.MkdirAll(elsewhere, 0o755); err != nil {
		t.Fatal(err)
	}

	var stdout, stderr bytes.Buffer
	code := run([]string{
		"-config", pod.configuration,
		"-source", pod.source,
		"-mount", elsewhere,
	}, &stdout, &stderr)
	if code != exitFailed {
		t.Fatalf("exit code = %d, stderr = %q", code, stderr.String())
	}
	for _, expected := range []string{pod.material, elsewhere} {
		if !strings.Contains(stderr.String(), expected) {
			t.Fatalf("the refusal does not name %s: %q", expected, stderr.String())
		}
	}
	if entries, err := os.ReadDir(elsewhere); err != nil || len(entries) != 0 {
		t.Fatalf("the command wrote into the wrong directory: entries = %v, error = %v", entries, err)
	}
}

// TestInstallRefusesASecretThatMissesAKey proves the negative that issue #444
// asks for. A missing file stops the init container, with a message. The
// service container never starts, so it cannot fall back to anything.
func TestInstallRefusesASecretThatMissesAKey(t *testing.T) {
	pod := newPod(t)
	pod.installOK(t)

	pod.removeSecretKey(t, "auth-pat-signing-key")

	var stdout, stderr bytes.Buffer
	if code := run([]string{
		"-config", pod.configuration,
		"-source", pod.source,
		"-mount", pod.material,
	}, &stdout, &stderr); code != exitFailed {
		t.Fatalf("exit code = %d", code)
	}
	if !strings.Contains(stderr.String(), "auth-pat-signing-key") {
		t.Fatalf("the refusal does not name the missing file: %q", stderr.String())
	}
	// The copy from the first run must be gone. A stale file would satisfy the
	// read-back check and keep serving material the Secret no longer carries.
	if _, err := os.Lstat(filepath.Join(pod.material, "auth-pat-signing-key")); err == nil {
		t.Fatal("the stale PAT signing key survived in the material directory")
	}
}

func TestRunReportsUsage(t *testing.T) {
	pod := newPod(t)
	complete := []string{"-config", pod.configuration, "-source", pod.source, "-mount", pod.material}
	for _, missing := range []string{"-config", "-source", "-mount"} {
		arguments := make([]string, 0, len(complete))
		for index := 0; index < len(complete); index += 2 {
			if complete[index] == missing {
				continue
			}
			arguments = append(arguments, complete[index], complete[index+1])
		}
		var stdout, stderr bytes.Buffer
		if code := run(arguments, &stdout, &stderr); code != exitUsage {
			t.Fatalf("exit code without %s = %d", missing, code)
		}
		if !strings.Contains(stderr.String(), missing) {
			t.Fatalf("the usage message does not name %s: %q", missing, stderr.String())
		}
	}
}

func TestRunRefusesAnUnreadableConfiguration(t *testing.T) {
	pod := newPod(t)
	var stdout, stderr bytes.Buffer
	if code := run([]string{
		"-config", filepath.Join(filepath.Dir(pod.material), "no-such-file.json"),
		"-source", pod.source,
		"-mount", pod.material,
	}, &stdout, &stderr); code != exitFailed {
		t.Fatalf("exit code = %d", code)
	}
	if !strings.Contains(stderr.String(), "authentication configuration") {
		t.Fatalf("the refusal does not name the cause: %q", stderr.String())
	}
}

// pod is one temporary stand-in for the Kubernetes pod: the authentication
// configuration that the ConfigMap carries, the Secret volume in the kubelet's
// own layout, and the empty directory that both containers mount.
type pod struct {
	configuration string
	source        string
	material      string
	contents      map[string][]byte
}

func newPod(t *testing.T) pod {
	t.Helper()
	// EvalSymlinks first: on macOS the temporary directory sits under a
	// symlinked /var, and securefile refuses a path that is not canonical.
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	material := filepath.Join(root, "elitea-auth")
	source := material + "-source"
	for _, directory := range []string{material, source} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	contents := map[string][]byte{
		"redis-auth-password":  []byte("an-auth-redis-password\n"),
		"auth-redis-ca.crt":    testCAPEM(t),
		"auth-attempt-key":     bytes.Repeat([]byte{0xa5}, 32),
		"auth-pat-signing-key": []byte("a-pat-signing-key"),
		"auth-form-users.json": []byte(`{"users":[{"login":"admin","password":"correct horse battery staple"}]}`),
	}

	configuration := filepath.Join(root, "auth-config.json")
	if err := os.WriteFile(configuration, []byte(authConfiguration(material)), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(configuration, 0o644); err != nil {
		t.Fatal(err)
	}

	created := pod{configuration: configuration, source: source, material: material, contents: contents}
	created.writeSecretVolume(t)
	return created
}

const projectedDirectory = "..2026_08_15_09_41_07.4184283913"

// writeSecretVolume reproduces the layout that the kubelet writes for a Secret
// volume mounted whole: one timestamped directory that holds the real files, a
// "..data" symlink to it, and one relative symlink for each key.
func (p pod) writeSecretVolume(t *testing.T) {
	t.Helper()
	data := filepath.Join(p.source, projectedDirectory)
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, raw := range p.contents {
		path := filepath.Join(data, name)
		if err := os.WriteFile(path, raw, secretVolumeMode); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(path, secretVolumeMode); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(projectedDirectory, filepath.Join(p.source, "..data")); err != nil {
		t.Fatal(err)
	}
	for name := range p.contents {
		if err := os.Symlink(filepath.Join("..data", name), filepath.Join(p.source, name)); err != nil {
			t.Fatal(err)
		}
	}
}

func (p pod) removeSecretKey(t *testing.T, name string) {
	t.Helper()
	for _, path := range []string{
		filepath.Join(p.source, projectedDirectory, name),
		filepath.Join(p.source, name),
	} {
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
	}
}

func (p pod) installOK(t *testing.T) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	if code := run([]string{
		"-config", p.configuration, "-source", p.source, "-mount", p.material,
	}, &stdout, &stderr); code != exitInstalled {
		t.Fatalf("the first install failed: %q", stderr.String())
	}
}

// authConfiguration is one complete authentication document whose five
// material paths sit in the given directory. It mirrors the shape of
// deploy/runtime/auth.form.yml.
func authConfiguration(directory string) string {
	return fmt.Sprintf(`schema_version: elitea.auth.form.v1
public_origin: https://elitea.example
trusted_proxy_cidrs:
  - 10.0.0.0/8
redirects:
  direct_access_denied: /app/
  main_access_denied: /app/
  default_login: /app/
  default_logout: /app/
cookie:
  name: elitea_browser_auth
  same_site: lax
  lifetime_seconds: 86400
redis:
  topology: single_primary_endpoint
  url: rediss://auth@redis.example:6380/0
  password_file: %[1]s/redis-auth-password
  ca_file: %[1]s/auth-redis-ca.crt
  key_prefix: "elitea-auth:"
  attempt_key_file: %[1]s/auth-attempt-key
credentials:
  pat_signing_key_file: %[1]s/auth-pat-signing-key
  credential_headers: []
mappers:
  contract: elitea.auth_mappers.tracked.v1
authorization:
  main_configured_public_rules: []
identity:
  initial_global_admins: []
provider:
  kind: form
  form:
    users_json_file: %[1]s/auth-form-users.json
`, directory)
}

func testCAPEM(t *testing.T) []byte {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "auth Redis test CA"},
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
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}
