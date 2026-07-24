// Package gateway holds the elitea-main edge control surfaces for the
// embedded Bifrost LLM gateway (governance authoring, budget alert toggles).
//
// BF0.0 introduces the global soft-alert emission control. Soft alerts are
// emitted by the gateway governance UsageTracker (PostLLMHook) when a budget
// crosses its threshold; this surface lets an operator enable/disable that
// emission platform-wide and set the default crossing threshold. It is a
// global (not per-project) control — per-project overrides land with the
// project_budget.soft_alert_pct column in a later task.
package gateway

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/go-chi/chi/v5"
)

// DefaultSoftAlertThresholdPct is the budget-utilisation percentage at which a
// soft alert fires when a project does not override it. Matches design §4.2.
const DefaultSoftAlertThresholdPct = 80

// BudgetAlertConfig is the platform-wide soft-alert emission setting.
type BudgetAlertConfig struct {
	// Enabled toggles global soft-alert emission. When false the gateway
	// governance UsageTracker records usage but emits no soft-alert events.
	Enabled bool `json:"enabled"`
	// ThresholdPct is the default budget-utilisation percentage (1..100) that
	// triggers a soft alert for projects without their own soft_alert_pct.
	ThresholdPct int `json:"threshold_pct"`
}

// BudgetAlertStore holds the global soft-alert config. It is safe for
// concurrent use across router replicas within a process.
type BudgetAlertStore struct {
	mu  sync.RWMutex
	cfg BudgetAlertConfig
}

// NewBudgetAlertStore returns a store initialised with soft-alert emission
// enabled at the default threshold — BF0.0 "enable global soft-alert emission".
func NewBudgetAlertStore() *BudgetAlertStore {
	return &BudgetAlertStore{
		cfg: BudgetAlertConfig{
			Enabled:      true,
			ThresholdPct: DefaultSoftAlertThresholdPct,
		},
	}
}

// Get returns a copy of the current config.
func (s *BudgetAlertStore) Get() BudgetAlertConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

// Update applies a partial update and returns the resulting config.
func (s *BudgetAlertStore) Update(req BudgetAlertUpdateRequest) BudgetAlertConfig {
	s.mu.Lock()
	defer s.mu.Unlock()
	if req.Enabled != nil {
		s.cfg.Enabled = *req.Enabled
	}
	if req.ThresholdPct != nil {
		s.cfg.ThresholdPct = *req.ThresholdPct
	}
	return s.cfg
}

// BudgetAlertUpdateRequest is a partial update; omitted fields are left as-is.
type BudgetAlertUpdateRequest struct {
	Enabled      *bool `json:"enabled,omitempty"`
	ThresholdPct *int  `json:"threshold_pct,omitempty"`
}

// BudgetAlertHandler serves the global soft-alert control surface.
type BudgetAlertHandler struct {
	store *BudgetAlertStore
}

// NewBudgetAlertHandler wires a handler over the given store.
func NewBudgetAlertHandler(store *BudgetAlertStore) *BudgetAlertHandler {
	return &BudgetAlertHandler{store: store}
}

// Routes mounts the budget-alerts read/write endpoints. The caller is
// responsible for RBAC gating (RequirePermissions) — the authorization
// boundary is the server, not the client.
func (h *BudgetAlertHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/budget-alerts", h.Get)
	r.Put("/budget-alerts", h.Update)
	return r
}

// Get returns the current global soft-alert config.
func (h *BudgetAlertHandler) Get(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, h.store.Get())
}

// Update applies a partial update to the global soft-alert config.
func (h *BudgetAlertHandler) Update(w http.ResponseWriter, r *http.Request) {
	var req BudgetAlertUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	if req.ThresholdPct != nil && (*req.ThresholdPct < 1 || *req.ThresholdPct > 100) {
		http.Error(w, `{"error":"threshold_pct must be between 1 and 100"}`, http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, h.store.Update(req))
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
