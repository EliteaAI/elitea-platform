package shadow_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/shadow"
)

func TestAdminHandler_GetConfig(t *testing.T) {
	comp := shadow.NewComparator(shadow.Config{
		Enabled:       true,
		LegacyBaseURL: "http://legacy:8000",
		Weight:        0.5,
		LogDiffs:      true,
		Timeout:       2 * time.Second,
	})
	metrics := shadow.NewMetrics(100)
	h := shadow.NewAdminHandler(comp, metrics)

	req := httptest.NewRequest(http.MethodGet, "/config", nil)
	w := httptest.NewRecorder()
	h.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var cfg map[string]any
	_ = json.NewDecoder(w.Body).Decode(&cfg)
	if cfg["enabled"] != true {
		t.Errorf("expected enabled true")
	}
	if cfg["weight"].(float64) != 0.5 {
		t.Errorf("expected weight 0.5, got %v", cfg["weight"])
	}
}

func TestAdminHandler_UpdateConfig(t *testing.T) {
	comp := shadow.NewComparator(shadow.Config{Enabled: false, Weight: 0.1, Timeout: 2 * time.Second})
	metrics := shadow.NewMetrics(100)
	h := shadow.NewAdminHandler(comp, metrics)

	body, _ := json.Marshal(map[string]any{"enabled": true, "weight": 0.8})
	req := httptest.NewRequest(http.MethodPut, "/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var cfg map[string]any
	_ = json.NewDecoder(w.Body).Decode(&cfg)
	if cfg["enabled"] != true {
		t.Errorf("expected enabled true after update")
	}
	if cfg["weight"].(float64) != 0.8 {
		t.Errorf("expected weight 0.8 after update, got %v", cfg["weight"])
	}
}

func TestAdminHandler_Stats(t *testing.T) {
	comp := shadow.NewComparator(shadow.Config{Timeout: 2 * time.Second})
	metrics := shadow.NewMetrics(100)
	metrics.Record(shadow.CompareResult{StatusMatch: true, BodyMatch: true})

	h := shadow.NewAdminHandler(comp, metrics)

	req := httptest.NewRequest(http.MethodGet, "/stats", nil)
	w := httptest.NewRecorder()
	h.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var stats map[string]any
	_ = json.NewDecoder(w.Body).Decode(&stats)
	if stats["total"].(float64) != 1 {
		t.Errorf("expected total 1, got %v", stats["total"])
	}
}

func TestAdminHandler_Reset(t *testing.T) {
	comp := shadow.NewComparator(shadow.Config{Timeout: 2 * time.Second})
	metrics := shadow.NewMetrics(100)
	metrics.Record(shadow.CompareResult{StatusMatch: true, BodyMatch: true})

	h := shadow.NewAdminHandler(comp, metrics)

	req := httptest.NewRequest(http.MethodPost, "/reset", nil)
	w := httptest.NewRecorder()
	h.Routes().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	stats := metrics.Stats()
	if stats.Total != 0 {
		t.Errorf("expected 0 after reset, got %d", stats.Total)
	}
}
