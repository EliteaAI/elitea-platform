package cutover

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
)

const (
	StateLegacy = "legacy"
	StateShadow = "shadow"
	StateCanary = "canary"
	StateGo     = "go"

	redisKey = "elitea:cutover:endpoints"
)

type EndpointState struct {
	Path      string    `json:"path"`
	Backend   string    `json:"backend"`
	UpdatedAt time.Time `json:"updated_at"`
	UpdatedBy string    `json:"updated_by,omitempty"`
}

type Tracker struct {
	redis redis.UniversalClient
}

func NewTracker(rdb redis.UniversalClient) *Tracker {
	return &Tracker{redis: rdb}
}

func (t *Tracker) Set(ctx context.Context, path, backend, updatedBy string) error {
	state := EndpointState{
		Path:      path,
		Backend:   backend,
		UpdatedAt: time.Now().UTC(),
		UpdatedBy: updatedBy,
	}
	data, _ := json.Marshal(state)
	return t.redis.HSet(ctx, redisKey, path, data).Err()
}

func (t *Tracker) Get(ctx context.Context, path string) (EndpointState, error) {
	val, err := t.redis.HGet(ctx, redisKey, path).Result()
	if err != nil {
		if err == redis.Nil {
			return EndpointState{Path: path, Backend: StateLegacy}, nil
		}
		return EndpointState{}, err
	}
	var state EndpointState
	if err := json.Unmarshal([]byte(val), &state); err != nil {
		return EndpointState{}, err
	}
	return state, nil
}

func (t *Tracker) List(ctx context.Context) ([]EndpointState, error) {
	all, err := t.redis.HGetAll(ctx, redisKey).Result()
	if err != nil {
		return nil, err
	}
	states := make([]EndpointState, 0, len(all))
	for _, v := range all {
		var s EndpointState
		if err := json.Unmarshal([]byte(v), &s); err != nil {
			continue
		}
		states = append(states, s)
	}
	return states, nil
}

func (t *Tracker) Summary(ctx context.Context) (map[string]int, error) {
	states, err := t.List(ctx)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{
		StateLegacy: 0,
		StateShadow: 0,
		StateCanary: 0,
		StateGo:     0,
	}
	for _, s := range states {
		counts[s.Backend]++
	}
	return counts, nil
}

// Admin HTTP handler

type AdminHandler struct {
	tracker *Tracker
}

func NewAdminHandler(tracker *Tracker) *AdminHandler {
	return &AdminHandler{tracker: tracker}
}

func (h *AdminHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Get("/summary", h.Summary)
	r.Put("/", h.Set)
	r.Get("/decommission", h.DecommissionReport)
	return r
}

func (h *AdminHandler) List(w http.ResponseWriter, r *http.Request) {
	states, err := h.tracker.List(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"endpoints": states})
}

func (h *AdminHandler) Summary(w http.ResponseWriter, r *http.Request) {
	summary, err := h.tracker.Summary(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

type setRequest struct {
	Path      string `json:"path"`
	Backend   string `json:"backend"`
	UpdatedBy string `json:"updated_by"`
}

func (h *AdminHandler) Set(w http.ResponseWriter, r *http.Request) {
	var req setRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Backend != StateLegacy && req.Backend != StateShadow && req.Backend != StateCanary && req.Backend != StateGo {
		http.Error(w, "backend must be one of: legacy, shadow, canary, go", http.StatusBadRequest)
		return
	}

	if err := h.tracker.Set(r.Context(), req.Path, req.Backend, req.UpdatedBy); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	state, _ := h.tracker.Get(r.Context(), req.Path)
	writeJSON(w, http.StatusOK, state)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
