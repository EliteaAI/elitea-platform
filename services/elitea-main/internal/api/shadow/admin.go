package shadow

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

type AdminHandler struct {
	comparator *Comparator
	metrics    *Metrics
}

func NewAdminHandler(comparator *Comparator, metrics *Metrics) *AdminHandler {
	return &AdminHandler{comparator: comparator, metrics: metrics}
}

func (h *AdminHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/config", h.GetConfig)
	r.Put("/config", h.UpdateConfig)
	r.Get("/stats", h.GetStats)
	r.Get("/results", h.GetResults)
	r.Post("/reset", h.ResetMetrics)
	return r
}

type ConfigResponse struct {
	Enabled       bool    `json:"enabled"`
	LegacyBaseURL string  `json:"legacy_base_url"`
	Weight        float64 `json:"weight"`
	LogDiffs      bool    `json:"log_diffs"`
}

type ConfigUpdateRequest struct {
	Enabled       *bool    `json:"enabled,omitempty"`
	LegacyBaseURL *string  `json:"legacy_base_url,omitempty"`
	Weight        *float64 `json:"weight,omitempty"`
	LogDiffs      *bool    `json:"log_diffs,omitempty"`
}

func (h *AdminHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	h.comparator.mu.RLock()
	cfg := ConfigResponse{
		Enabled:       h.comparator.cfg.Enabled,
		LegacyBaseURL: h.comparator.cfg.LegacyBaseURL,
		Weight:        h.comparator.cfg.Weight,
		LogDiffs:      h.comparator.cfg.LogDiffs,
	}
	h.comparator.mu.RUnlock()

	writeJSON(w, http.StatusOK, cfg)
}

func (h *AdminHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	var req ConfigUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	h.comparator.mu.Lock()
	if req.Enabled != nil {
		h.comparator.cfg.Enabled = *req.Enabled
	}
	if req.LegacyBaseURL != nil {
		h.comparator.cfg.LegacyBaseURL = *req.LegacyBaseURL
	}
	if req.Weight != nil {
		h.comparator.cfg.Weight = *req.Weight
	}
	if req.LogDiffs != nil {
		h.comparator.cfg.LogDiffs = *req.LogDiffs
	}
	h.comparator.mu.Unlock()

	h.GetConfig(w, r)
}

func (h *AdminHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.metrics.Stats())
}

func (h *AdminHandler) GetResults(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": h.metrics.Recent(limit)})
}

func (h *AdminHandler) ResetMetrics(w http.ResponseWriter, r *http.Request) {
	h.metrics.Reset()
	writeJSON(w, http.StatusOK, map[string]string{"status": "reset"})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
