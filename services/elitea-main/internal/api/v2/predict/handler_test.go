package predict

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/predict"
)

type mockPredictor struct{}

func (m *mockPredictor) Predict(_ context.Context, req predict.Request) (predict.Response, error) {
	return predict.Response{
		MessageGroupUID: "msg-123",
		Content:         "Hello from " + req.ProjectID,
	}, nil
}

func (m *mockPredictor) PredictStream(_ context.Context, _ predict.Request, send func(predict.StreamEvent) error) error {
	send(predict.StreamEvent{Type: "token", Content: "Hello"})
	send(predict.StreamEvent{Type: "token", Content: " world"})
	send(predict.StreamEvent{Type: "done", Done: true})
	return nil
}

type mockLLM struct{}

func (m *mockLLM) Complete(_ context.Context, req predict.LLMRequest) (predict.LLMResponse, error) {
	return predict.LLMResponse{Content: "LLM response", Model: req.Model}, nil
}

func (m *mockLLM) CompleteStream(_ context.Context, _ predict.LLMRequest, send func(predict.StreamEvent) error) error {
	send(predict.StreamEvent{Type: "token", Content: "streamed"})
	send(predict.StreamEvent{Type: "done", Done: true})
	return nil
}

func TestPredict_JSON(t *testing.T) {
	h := NewHandler(&mockPredictor{}, &mockLLM{})

	r := chi.NewRouter()
	r.Route("/api/v2/projects/{projectID}/predict", func(r chi.Router) {
		r.Mount("/", h.Routes())
	})

	body, _ := json.Marshal(predict.Request{Input: "hello", VersionID: "v1"})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/predict/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp predict.Response
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Content != "Hello from proj-1" {
		t.Errorf("unexpected content: %s", resp.Content)
	}
}

func TestPredict_Stream(t *testing.T) {
	h := NewHandler(&mockPredictor{}, &mockLLM{})

	r := chi.NewRouter()
	r.Route("/api/v2/projects/{projectID}/predict", func(r chi.Router) {
		r.Mount("/", h.Routes())
	})

	body, _ := json.Marshal(predict.Request{Input: "hello", Stream: true})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/predict/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	ct := w.Header().Get("Content-Type")
	if ct != "text/event-stream" {
		t.Errorf("expected text/event-stream, got %s", ct)
	}

	output := w.Body.String()
	if !strings.Contains(output, "event: token") {
		t.Errorf("expected SSE token events, got: %s", output)
	}
	if !strings.Contains(output, "event: done") {
		t.Errorf("expected SSE done event, got: %s", output)
	}
}

func TestLLM_JSON(t *testing.T) {
	h := NewHandler(&mockPredictor{}, &mockLLM{})

	r := chi.NewRouter()
	r.Route("/api/v2/projects/{projectID}/predict", func(r chi.Router) {
		r.Mount("/", h.Routes())
	})

	body, _ := json.Marshal(predict.LLMRequest{
		Model:    "gpt-4",
		Messages: []predict.LLMMessage{{Role: "user", Content: "hi"}},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/predict/llm", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp predict.LLMResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.Model != "gpt-4" {
		t.Errorf("unexpected model: %s", resp.Model)
	}
}

func TestLLM_Stream(t *testing.T) {
	h := NewHandler(&mockPredictor{}, &mockLLM{})

	r := chi.NewRouter()
	r.Route("/api/v2/projects/{projectID}/predict", func(r chi.Router) {
		r.Mount("/", h.Routes())
	})

	body, _ := json.Marshal(predict.LLMRequest{
		Model:    "gpt-4",
		Messages: []predict.LLMMessage{{Role: "user", Content: "hi"}},
		Stream:   true,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/predict/llm", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	ct := w.Header().Get("Content-Type")
	if ct != "text/event-stream" {
		t.Errorf("expected text/event-stream, got %s", ct)
	}

	output := w.Body.String()
	if !strings.Contains(output, "streamed") {
		t.Errorf("expected streamed content, got: %s", output)
	}
}
