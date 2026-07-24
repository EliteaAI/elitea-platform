package gateway

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestHandler() (*BudgetAlertHandler, *BudgetAlertStore) {
	store := NewBudgetAlertStore()
	return NewBudgetAlertHandler(store), store
}

func decodeConfig(t *testing.T, body *bytes.Buffer) BudgetAlertConfig {
	t.Helper()
	var cfg BudgetAlertConfig
	if err := json.NewDecoder(body).Decode(&cfg); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return cfg
}

func TestNewBudgetAlertStoreDefaults(t *testing.T) {
	cfg := NewBudgetAlertStore().Get()
	if !cfg.Enabled {
		t.Errorf("soft-alert emission should default to enabled")
	}
	if cfg.ThresholdPct != DefaultSoftAlertThresholdPct {
		t.Errorf("default threshold = %d, want %d", cfg.ThresholdPct, DefaultSoftAlertThresholdPct)
	}
}

func TestGetReturnsCurrentConfig(t *testing.T) {
	h, _ := newTestHandler()
	rr := httptest.NewRecorder()
	h.Routes().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/budget-alerts", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("content-type = %q, want application/json", ct)
	}
	cfg := decodeConfig(t, rr.Body)
	if !cfg.Enabled || cfg.ThresholdPct != DefaultSoftAlertThresholdPct {
		t.Errorf("unexpected default config: %+v", cfg)
	}
}

func TestUpdateDisablesEmission(t *testing.T) {
	h, store := newTestHandler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/budget-alerts", bytes.NewBufferString(`{"enabled":false}`))
	h.Routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	cfg := decodeConfig(t, rr.Body)
	if cfg.Enabled {
		t.Errorf("enabled should be false after update")
	}
	// Threshold untouched by a partial update.
	if cfg.ThresholdPct != DefaultSoftAlertThresholdPct {
		t.Errorf("threshold changed unexpectedly: %d", cfg.ThresholdPct)
	}
	if store.Get().Enabled {
		t.Errorf("store not persisted: still enabled")
	}
}

func TestUpdateThresholdOnly(t *testing.T) {
	h, _ := newTestHandler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/budget-alerts", bytes.NewBufferString(`{"threshold_pct":90}`))
	h.Routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	cfg := decodeConfig(t, rr.Body)
	if cfg.ThresholdPct != 90 {
		t.Errorf("threshold = %d, want 90", cfg.ThresholdPct)
	}
	if !cfg.Enabled {
		t.Errorf("enabled should remain true (partial update)")
	}
}

func TestUpdateRejectsOutOfRangeThreshold(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
	}{
		{"zero", `{"threshold_pct":0}`},
		{"negative", `{"threshold_pct":-5}`},
		{"over-100", `{"threshold_pct":101}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, store := newTestHandler()
			rr := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPut, "/budget-alerts", bytes.NewBufferString(tc.body))
			h.Routes().ServeHTTP(rr, req)

			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", rr.Code)
			}
			if store.Get().ThresholdPct != DefaultSoftAlertThresholdPct {
				t.Errorf("invalid update mutated store: %d", store.Get().ThresholdPct)
			}
		})
	}
}

func TestUpdateRejectsMalformedBody(t *testing.T) {
	h, _ := newTestHandler()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/budget-alerts", bytes.NewBufferString(`{not json`))
	h.Routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestUpdateBoundaryThresholds(t *testing.T) {
	for _, want := range []int{1, 100} {
		h, _ := newTestHandler()
		rr := httptest.NewRecorder()
		body := bytes.NewBuffer(nil)
		_ = json.NewEncoder(body).Encode(BudgetAlertUpdateRequest{ThresholdPct: &want})
		h.Routes().ServeHTTP(rr, httptest.NewRequest(http.MethodPut, "/budget-alerts", body))

		if rr.Code != http.StatusOK {
			t.Fatalf("threshold %d: status = %d, want 200", want, rr.Code)
		}
		if got := decodeConfig(t, rr.Body).ThresholdPct; got != want {
			t.Errorf("threshold = %d, want %d", got, want)
		}
	}
}

func TestUpdateEmptyBodyIsNoOp(t *testing.T) {
	h, _ := newTestHandler()
	rr := httptest.NewRecorder()
	h.Routes().ServeHTTP(rr, httptest.NewRequest(http.MethodPut, "/budget-alerts", bytes.NewBufferString(`{}`)))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	cfg := decodeConfig(t, rr.Body)
	if !cfg.Enabled || cfg.ThresholdPct != DefaultSoftAlertThresholdPct {
		t.Errorf("empty update should leave defaults: %+v", cfg)
	}
}
