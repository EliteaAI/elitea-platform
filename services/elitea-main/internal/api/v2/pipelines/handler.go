package pipelines

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/predict"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type PipelineStatus struct {
	TaskID    string `json:"task_id"`
	Status    string `json:"status"`
	Result    any    `json:"result,omitempty"`
	Error     string `json:"error,omitempty"`
	StartedAt string `json:"started_at,omitempty"`
	EndedAt   string `json:"ended_at,omitempty"`
}

type Runner interface {
	Run(ctx context.Context, req predict.PipelineRunRequest) (predict.PipelineRunResponse, error)
	Status(ctx context.Context, projectID, taskID string) (PipelineStatus, error)
	Cancel(ctx context.Context, projectID, taskID string) error
}

type Handler struct {
	runner Runner
	pool   *pgxpool.Pool
}

func NewHandler(runner Runner) *Handler {
	return &Handler{runner: runner}
}

func (h *Handler) WithPool(pool *pgxpool.Pool) *Handler {
	h.pool = pool
	return h
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/run", h.Run)
	r.Get("/{taskID}/status", h.Status)
	r.Post("/{taskID}/cancel", h.Cancel)
	return r
}

func (h *Handler) Run(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var req predict.PipelineRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	req.ProjectID = projectID

	resp, err := h.runner.Run(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, resp)
}

func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	taskID := chi.URLParam(r, "taskID")

	status, err := h.runner.Status(r.Context(), projectID, taskID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	taskID := chi.URLParam(r, "taskID")

	if err := h.runner.Cancel(r.Context(), projectID, taskID); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

func (h *Handler) Trigger(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	versionID := chi.URLParam(r, "versionID")

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	req := predict.PipelineRunRequest{
		ProjectID: projectID,
		VersionID: versionID,
	}

	resp, err := h.runner.Run(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, resp)
}

func (h *Handler) GetTrigger(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	versionID := chi.URLParam(r, "versionID")

	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"version_id": versionID,
			"enabled":    false,
			"schedule":   nil,
		})
		return
	}

	ctx := r.Context()
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`SELECT COALESCE(settings, '{}') FROM %q.application_versions WHERE id = $1`, s)

	var settingsRaw []byte
	if err := h.pool.QueryRow(ctx, q, versionID).Scan(&settingsRaw); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"version_id": versionID,
			"enabled":    false,
			"schedule":   nil,
		})
		return
	}

	var settings map[string]any
	// settingsRaw is a DB JSONB column we just read; unmarshal failure is safe to ignore here
	_ = json.Unmarshal(settingsRaw, &settings)

	trigger, _ := settings["trigger"].(map[string]any)
	if trigger == nil {
		trigger = map[string]any{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"version_id": versionID,
		"enabled":    trigger["enabled"],
		"schedule":   trigger["schedule"],
		"type":       trigger["type"],
	})
}

func (h *Handler) UpdateTrigger(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	versionID := chi.URLParam(r, "versionID")

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	if h.pool == nil {
		body["version_id"] = versionID
		writeJSON(w, http.StatusOK, body)
		return
	}

	ctx := r.Context()
	s := fmt.Sprintf("p_%s", projectID)

	triggerBytes, _ := json.Marshal(body)
	q := fmt.Sprintf(`UPDATE %q.application_versions SET settings = jsonb_set(COALESCE(settings, '{}')::jsonb, '{trigger}', $1) WHERE id = $2`, s)
	if _, err := h.pool.Exec(ctx, q, triggerBytes, versionID); err != nil {
		apierr.Write(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"version_id": versionID,
		"enabled":    body["enabled"],
		"schedule":   body["schedule"],
		"type":       body["type"],
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
