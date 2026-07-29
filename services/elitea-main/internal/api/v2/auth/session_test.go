package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSessionTokenRequiresExpirationAndPositiveUserID(t *testing.T) {
	const secret = "session-secret"
	valid := makeSessionToken(secret, "7", "owner@example.test")
	claims, err := verifySessionToken(secret, valid)
	if err != nil {
		t.Fatal(err)
	}
	if id, ok := sessionClaimUserID(claims); !ok || id != 7 {
		t.Fatalf("session user ID = %d, %v; want 7", id, ok)
	}

	withoutExpiryPayload := base64.RawURLEncoding.EncodeToString([]byte(`{"uid":"7","email":"owner@example.test"}`))
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(withoutExpiryPayload))
	withoutExpiry := withoutExpiryPayload + "." + hex.EncodeToString(mac.Sum(nil))
	if _, err := verifySessionToken(secret, withoutExpiry); err == nil {
		t.Fatal("signed session without expiration was accepted")
	}

	if _, ok := sessionClaimUserID(map[string]any{"uid": float64(7.5)}); ok {
		t.Fatal("fractional session user ID was accepted")
	}
}

func TestSafeRedirectTargetAllowsOnlySameOriginPaths(t *testing.T) {
	for _, test := range []struct {
		input string
		want  string
	}{
		{input: "", want: "/"},
		{input: "/", want: "/"},
		{input: "/app/chat?project=7#message", want: "/app/chat?project=7#message"},
		{input: "https://attacker.example/path", want: "/"},
		{input: "//attacker.example/path", want: "/"},
		{input: `/\\attacker.example`, want: "/"},
		{input: "app/relative", want: "/"},
		{input: "/ok\r\nLocation: https://attacker.example", want: "/"},
	} {
		if got := safeRedirectTarget(test.input); got != test.want {
			t.Errorf("safeRedirectTarget(%q) = %q, want %q", test.input, got, test.want)
		}
	}
}

func TestLogoutUsesSecureCookieAndRejectsExternalRedirect(t *testing.T) {
	handler := NewSessionHandler(nil, "secret")
	req := httptest.NewRequest(http.MethodGet, "/logout?target_to=https://attacker.example", nil)
	rec := httptest.NewRecorder()

	handler.Logout(rec, req)

	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/" {
		t.Fatalf("status=%d location=%q", rec.Code, rec.Header().Get("Location"))
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("logout cookie = %+v", cookies)
	}
}
