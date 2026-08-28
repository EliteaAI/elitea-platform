package adminui

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The admin SPA served no Content-Security-Policy at all (issue #177). Only
// the browserauth login page set one.
//
// These tests assert the two halves that make a CSP worth having, because a
// header that is merely PRESENT is the usual way this control fails:
//
//  1. it refuses inline script (no 'unsafe-inline'), so an injected
//     <script> in this page does not run;
//  2. the one inline script the handler DOES emit is authorised by a hash of
//     its own bytes, so the policy cannot white-screen the console — which is
//     how a correct-looking hash policy usually fails.

const cspTestSecret = "test-secret-key"

// adminIndexFixture writes an index.html shaped like the real built one: the
// injection marker, plus the module script tag Vite emits for the bundle.
func adminIndexFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	const page = `<!doctype html><html><head>` +
		`<!-- admin_ui_config -->` +
		`<script type="module" crossorigin src="./assets/index.js"></script>` +
		`</head><body><div id="root"></div></body></html>`
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte(page), 0o600); err != nil {
		t.Fatalf("write index.html: %v", err)
	}
	return dir
}

func cspTestSessionCookie(t *testing.T, email string) string {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"uid":   1,
		"email": email,
		"exp":   float64(time.Now().Add(time.Hour).Unix()),
	})
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(cspTestSecret))
	mac.Write([]byte(encoded))
	return encoded + "." + hex.EncodeToString(mac.Sum(nil))
}

// serveAdminPage drives the real ServeSPA and returns the response recorder.
func serveAdminPage(t *testing.T, staticDir, email string) *httptest.ResponseRecorder {
	t.Helper()
	handler := NewHandler(Config{
		StaticDir:     staticDir,
		ViteServerURL: "/api/v2",
		BasePath:      "/admin/app",
		SecretKey:     cspTestSecret,
	})
	req := httptest.NewRequest(http.MethodGet, "/admin/app/", nil)
	if email != "" {
		req.AddCookie(&http.Cookie{Name: "elitea_session", Value: cspTestSessionCookie(t, email)})
	}
	rec := httptest.NewRecorder()
	handler.ServeSPA(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	return rec
}

// inlineScriptBody returns the text between the first bare <script> and its
// </script> — the block the CSP hash must authorise.
func inlineScriptBody(t *testing.T, body string) string {
	t.Helper()
	open := strings.Index(body, "<script>")
	if open < 0 {
		t.Fatalf("no bare <script> block in the response:\n%s", body)
	}
	rest := body[open+len("<script>"):]
	closing := strings.Index(rest, "</script>")
	if closing < 0 {
		t.Fatalf("inline script is not closed:\n%s", body)
	}
	return rest[:closing]
}

func TestServeSPA_SetsContentSecurityPolicy(t *testing.T) {
	t.Parallel()

	rec := serveAdminPage(t, adminIndexFixture(t), "operator@example.com")
	csp := rec.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Fatal("no Content-Security-Policy header on the admin SPA response")
	}

	for _, directive := range []string{
		"default-src 'self'",
		"base-uri 'none'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"form-action 'self'",
		"connect-src 'self'",
	} {
		if !strings.Contains(csp, directive) {
			t.Errorf("CSP is missing %q:\n%s", directive, csp)
		}
	}

	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", rec.Header().Get("X-Content-Type-Options"))
	}
}

func TestServeSPA_ContentSecurityPolicyRefusesInlineScript(t *testing.T) {
	t.Parallel()

	rec := serveAdminPage(t, adminIndexFixture(t), "operator@example.com")
	csp := rec.Header().Get("Content-Security-Policy")

	scriptSrc := directiveOf(t, csp, "script-src")
	if strings.Contains(scriptSrc, "'unsafe-inline'") {
		t.Fatalf("script-src allows 'unsafe-inline', which is the whole hole this closes:\n%s", csp)
	}
	if strings.Contains(scriptSrc, "'unsafe-eval'") || strings.Contains(scriptSrc, "*") {
		t.Fatalf("script-src is too permissive to refuse an injected script:\n%s", csp)
	}
}

// The failure mode of a hash policy is a hash that does not match the script
// it is supposed to authorise: the header looks right and the console renders
// a blank page. This computes the hash from the bytes actually served.
func TestServeSPA_ContentSecurityPolicyHashAuthorisesTheInjectedConfig(t *testing.T) {
	t.Parallel()

	dir := adminIndexFixture(t)

	// Two different operators, so a hardcoded hash cannot pass this: the
	// injected payload differs, and each response must carry its own.
	seen := map[string]bool{}
	for _, email := range []string{"operator@example.com", "o'brien@example.com"} {
		rec := serveAdminPage(t, dir, email)
		body := rec.Body.String()
		csp := rec.Header().Get("Content-Security-Policy")

		if !strings.Contains(body, "window.admin_ui_config") {
			t.Fatalf("config was not injected, so this proves nothing:\n%s", body)
		}

		digest := sha256.Sum256([]byte(inlineScriptBody(t, body)))
		want := "'sha256-" + base64.StdEncoding.EncodeToString(digest[:]) + "'"
		if !strings.Contains(directiveOf(t, csp, "script-src"), want) {
			t.Fatalf("script-src does not authorise the inline script it serves.\nwant hash %s\ncsp: %s", want, csp)
		}
		seen[want] = true
	}

	if len(seen) != 2 {
		t.Fatal("both operators produced the same hash; the hash is not derived from the response")
	}
}

// A deployment with no admin bundle on disk still serves a document, and it
// must not be the one page in the service that has no policy.
func TestServeSPA_SetsContentSecurityPolicyWithoutABundle(t *testing.T) {
	t.Parallel()

	rec := serveAdminPage(t, filepath.Join(t.TempDir(), "absent"), "")
	if rec.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("no Content-Security-Policy on the missing-bundle fallback page")
	}
}

// directiveOf returns one directive's value from a policy string.
func directiveOf(t *testing.T, csp, name string) string {
	t.Helper()
	for _, part := range strings.Split(csp, ";") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, name+" ") {
			return part
		}
	}
	t.Fatalf("CSP has no %s directive:\n%s", name, csp)
	return ""
}
