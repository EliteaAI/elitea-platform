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

// TestAdminUIConfigInjection_CannotBreakOutOfTheScript guards the admin SPA's
// config injection against script injection (CodeQL go/unsafe-quoting, alert 9,
// critical).
//
// The previous form was:
//
//	<script>window.admin_ui_config = JSON.parse('<json>');</script>
//
// which places attacker-influenced text inside a single-quoted JS string. That
// is reachable rather than theoretical: UserEmail/UserName come from the session
// JWT's `email` claim (ServeSPA), and a single quote is legal in an email local
// part — o'brien@example.com — so an ordinary user with such an address executes
// script in the ADMIN page.
//
// NOTE ON THIS TEST'S SHAPE, because the first version of it was worthless: it
// originally built the <script> string itself and asserted properties of its own
// construction, so mutating handler.go could not fail it. It now drives the REAL
// ServeSPA through httptest and asserts on the bytes actually served. Verified by
// mutation: restoring the JSON.parse('%s') form makes this fail.
func TestAdminUIConfigInjection_CannotBreakOutOfTheScript(t *testing.T) {
	t.Parallel()

	const secret = "test-secret-key"

	// A session token in the exact shape verifySession expects:
	// base64url(payload) + "." + hex(HMAC-SHA256(payload)).
	sessionCookie := func(t *testing.T, email string) string {
		t.Helper()
		payload, err := json.Marshal(map[string]any{
			"user_id": 1,
			"email":   email,
			"exp":     float64(time.Now().Add(time.Hour).Unix()),
		})
		if err != nil {
			t.Fatalf("marshal claims: %v", err)
		}
		encoded := base64.RawURLEncoding.EncodeToString(payload)
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(encoded))
		return encoded + "." + hex.EncodeToString(mac.Sum(nil))
	}

	hostile := []struct {
		name  string
		email string
	}{
		{"single quote closes the old string literal", `a'+alert(1)+'@example.com`},
		{"legitimate address that happens to contain a quote", `o'brien@example.com`},
		{"script close tag", `x</script><script>alert(1)</script>@example.com`},
		{"backslash before quote", `a\'@example.com`},
		{"double quote", `a"@example.com`},
	}

	for _, tc := range hostile {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			dir := t.TempDir()
			if err := os.WriteFile(
				filepath.Join(dir, "index.html"),
				[]byte("<html><body><!-- admin_ui_config --></body></html>"),
				0o600,
			); err != nil {
				t.Fatalf("write index.html: %v", err)
			}

			handler := NewHandler(Config{
				StaticDir:     dir,
				ViteServerURL: "/api/v2",
				BasePath:      "/admin/app",
				SecretKey:     secret,
			})

			req := httptest.NewRequest(http.MethodGet, "/admin/app/", nil)
			req.AddCookie(&http.Cookie{Name: "elitea_session", Value: sessionCookie(t, tc.email)})
			rec := httptest.NewRecorder()

			handler.ServeSPA(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			body := rec.Body.String()

			// Precondition: the hostile value really did reach the page. Without
			// this the assertions below could pass simply because nothing was
			// injected at all.
			if !strings.Contains(body, "admin_ui_config") {
				t.Fatalf("config was not injected into the page:\n%s", body)
			}

			// 1. No single-quoted JS string wrapping the payload — that is the
			//    construct a quote escapes from.
			if strings.Contains(body, "JSON.parse('") {
				t.Fatalf("config is wrapped in a single-quoted string; the injection "+
					"hole is reopened:\n%s", body)
			}

			// 2. The payload must not be able to terminate the enclosing tag.
			//    json.Marshal escapes '<' to < by default; if that is ever
			//    disabled (e.g. an Encoder with SetEscapeHTML(false)), this catches it.
			openIdx := strings.Index(body, "<script>")
			if openIdx < 0 {
				t.Fatalf("no <script> block in the response:\n%s", body)
			}
			afterOpen := body[openIdx+len("<script>"):]
			closeIdx := strings.Index(afterOpen, "</script>")
			if closeIdx < 0 {
				t.Fatalf("script block is not closed:\n%s", body)
			}
			if strings.Contains(afterOpen[:closeIdx], "</script") {
				t.Fatalf("payload terminated the script tag early:\n%s", body)
			}

			// 3. The value must survive intact — the fix must not be "mangle it".
			inner := afterOpen[:closeIdx]
			jsonPart := strings.TrimSuffix(
				strings.TrimPrefix(strings.TrimSpace(inner), "window.admin_ui_config = "), ";")
			var back adminUIConfig
			if err := json.Unmarshal([]byte(jsonPart), &back); err != nil {
				t.Fatalf("emitted config is not valid JSON (%v):\n%s", err, inner)
			}
			if back.UserEmail != tc.email {
				t.Fatalf("email round-trip = %q, want %q", back.UserEmail, tc.email)
			}
		})
	}
}
