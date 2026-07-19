package shadow_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/shadow"
)

func TestComparator_Disabled(t *testing.T) {
	c := shadow.NewComparator(shadow.Config{Enabled: false})
	result := c.Compare(context.Background(), "GET", "/test", 200, []byte(`{"ok":true}`), nil)

	if result.Endpoint != "/test" {
		t.Errorf("expected endpoint /test, got %q", result.Endpoint)
	}
	if result.LegacyStatus != 0 {
		t.Errorf("expected 0 legacy status when disabled, got %d", result.LegacyStatus)
	}
}

func TestComparator_MatchingResponse(t *testing.T) {
	body := `{"status":"ok"}`
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(body))
	}))
	defer legacy.Close()

	c := shadow.NewComparator(shadow.Config{
		Enabled:       true,
		LegacyBaseURL: legacy.URL,
		Timeout:       2 * time.Second,
		LogDiffs:      true,
	})

	result := c.Compare(context.Background(), "GET", "/healthz", http.StatusOK, []byte(body), nil)

	if !result.StatusMatch {
		t.Error("expected status match")
	}
	if !result.BodyMatch {
		t.Error("expected body match")
	}
	if result.LegacyStatus != 200 {
		t.Errorf("expected legacy status 200, got %d", result.LegacyStatus)
	}
}

func TestComparator_StatusMismatch(t *testing.T) {
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"not found"}`))
	}))
	defer legacy.Close()

	c := shadow.NewComparator(shadow.Config{
		Enabled:       true,
		LegacyBaseURL: legacy.URL,
		Timeout:       2 * time.Second,
		LogDiffs:      true,
	})

	result := c.Compare(context.Background(), "GET", "/missing", http.StatusOK, []byte(`{"ok":true}`), nil)

	if result.StatusMatch {
		t.Error("expected status mismatch")
	}
	if result.LegacyStatus != 404 {
		t.Errorf("expected legacy 404, got %d", result.LegacyStatus)
	}
}

func TestComparator_BodyMismatch(t *testing.T) {
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"value":"old"}`))
	}))
	defer legacy.Close()

	c := shadow.NewComparator(shadow.Config{
		Enabled:       true,
		LegacyBaseURL: legacy.URL,
		Timeout:       2 * time.Second,
		LogDiffs:      true,
	})

	result := c.Compare(context.Background(), "GET", "/api/test", http.StatusOK, []byte(`{"value":"new"}`), nil)

	if !result.StatusMatch {
		t.Error("expected status match")
	}
	if result.BodyMatch {
		t.Error("expected body mismatch")
	}
	if len(result.Diffs) == 0 {
		t.Error("expected diffs to be populated")
	}
}

func TestComparator_SetWeight(t *testing.T) {
	c := shadow.NewComparator(shadow.Config{Weight: 0.5})
	if c.Weight() != 0.5 {
		t.Errorf("expected weight 0.5, got %f", c.Weight())
	}
	c.SetWeight(0.8)
	if c.Weight() != 0.8 {
		t.Errorf("expected weight 0.8, got %f", c.Weight())
	}
}

func TestComparator_HeaderForwarding(t *testing.T) {
	var receivedAuth string
	legacy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer legacy.Close()

	c := shadow.NewComparator(shadow.Config{
		Enabled:       true,
		LegacyBaseURL: legacy.URL,
		Timeout:       2 * time.Second,
	})

	headers := http.Header{}
	headers.Set("Authorization", "Bearer test-token")

	c.Compare(context.Background(), "GET", "/api/v2/test", http.StatusOK, []byte(`{}`), headers)

	if receivedAuth != "Bearer test-token" {
		t.Errorf("expected Authorization header forwarded, got %q", receivedAuth)
	}
}

func TestMiddleware_PassesThrough(t *testing.T) {
	c := shadow.NewComparator(shadow.Config{Enabled: false})
	handler := shadow.Middleware(c)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}
