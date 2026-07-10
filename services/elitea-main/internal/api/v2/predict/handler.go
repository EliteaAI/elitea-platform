package predict

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/predict"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/ssewriter"
)

type Predictor interface {
	Predict(ctx context.Context, req predict.Request) (predict.Response, error)
	PredictStream(ctx context.Context, req predict.Request, send func(predict.StreamEvent) error) error
}

type LLMService interface {
	Complete(ctx context.Context, req predict.LLMRequest) (predict.LLMResponse, error)
	CompleteStream(ctx context.Context, req predict.LLMRequest, send func(predict.StreamEvent) error) error
}

type Handler struct {
	predictor  Predictor
	llmService LLMService
}

func NewHandler(predictor Predictor, llmService LLMService) *Handler {
	return &Handler{predictor: predictor, llmService: llmService}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/", h.Predict)
	r.Post("/llm", h.LLM)
	return r
}

func (h *Handler) Predict(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var req predict.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	req.ProjectID = projectID

	if req.Stream {
		h.streamPredict(w, r, req)
		return
	}

	resp, err := h.predictor.Predict(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) streamPredict(w http.ResponseWriter, r *http.Request, req predict.Request) {
	sse, err := ssewriter.New(w)
	if err != nil {
		apierr.Write(w, apierr.Internal("streaming not supported"))
		return
	}

	send := func(evt predict.StreamEvent) error {
		data, _ := json.Marshal(evt)
		return sse.Event(evt.Type, string(data))
	}

	if err := h.predictor.PredictStream(r.Context(), req, send); err != nil {
		errData, _ := json.Marshal(map[string]string{"error": err.Error()})
		sse.Event("error", string(errData))
	}
}

func (h *Handler) LLM(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var req predict.LLMRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	req.ProjectID = projectID

	if req.Stream {
		h.streamLLM(w, r, req)
		return
	}

	resp, err := h.llmService.Complete(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) streamLLM(w http.ResponseWriter, r *http.Request, req predict.LLMRequest) {
	sse, err := ssewriter.New(w)
	if err != nil {
		apierr.Write(w, apierr.Internal("streaming not supported"))
		return
	}

	send := func(evt predict.StreamEvent) error {
		data, _ := json.Marshal(evt)
		return sse.Event(evt.Type, string(data))
	}

	if err := h.llmService.CompleteStream(r.Context(), req, send); err != nil {
		errData, _ := json.Marshal(map[string]string{"error": err.Error()})
		sse.Event("error", string(errData))
	}
}

func (h *Handler) CancelTask(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "cancelled"})
}

func (h *Handler) GetTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskID")
	writeJSON(w, http.StatusOK, map[string]any{
		"task_id": taskID,
		"status":  "completed",
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
