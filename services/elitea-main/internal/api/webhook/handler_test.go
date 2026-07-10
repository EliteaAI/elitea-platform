package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

type mockWebhookRepo struct {
	webhooks []Webhook
}

func (m *mockWebhookRepo) List(_ context.Context, _ string) ([]Webhook, error) {
	return m.webhooks, nil
}

func (m *mockWebhookRepo) Create(_ context.Context, projectID string, wh Webhook) (Webhook, error) {
	wh.ID = "wh-new"
	wh.ProjectID = projectID
	wh.CreatedAt = time.Now()
	wh.UpdatedAt = time.Now()
	m.webhooks = append(m.webhooks, wh)
	return wh, nil
}

func (m *mockWebhookRepo) Get(_ context.Context, _ string, id string) (Webhook, error) {
	for _, wh := range m.webhooks {
		if wh.ID == id {
			return wh, nil
		}
	}
	return Webhook{}, nil
}

func (m *mockWebhookRepo) Update(_ context.Context, _ string, id string, wh Webhook) (Webhook, error) {
	wh.ID = id
	wh.UpdatedAt = time.Now()
	return wh, nil
}

func (m *mockWebhookRepo) Delete(_ context.Context, _ string, _ string) error {
	return nil
}

func (m *mockWebhookRepo) ListByEvent(_ context.Context, _ string, _ string) ([]Webhook, error) {
	return m.webhooks, nil
}

func TestHandler_List(t *testing.T) {
	repo := &mockWebhookRepo{
		webhooks: []Webhook{
			{ID: "wh-1", ProjectID: "proj-1", URL: "https://example.com/hook", Events: []string{"application.created"}, Active: true},
		},
	}
	h := NewHandler(repo)

	r := chi.NewRouter()
	r.Route("/api/v2/projects/{projectID}/webhooks", func(r chi.Router) {
		r.Mount("/", h.Routes())
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/webhooks/", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var body map[string]any
	json.NewDecoder(w.Body).Decode(&body)
	items := body["items"].([]any)
	if len(items) != 1 {
		t.Errorf("expected 1 webhook, got %d", len(items))
	}
}

func TestHandler_Create(t *testing.T) {
	repo := &mockWebhookRepo{}
	h := NewHandler(repo)

	r := chi.NewRouter()
	r.Route("/api/v2/projects/{projectID}/webhooks", func(r chi.Router) {
		r.Mount("/", h.Routes())
	})

	payload, _ := json.Marshal(Webhook{URL: "https://example.com/hook", Events: []string{"skill.created"}, Active: true})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/webhooks/", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var wh Webhook
	json.NewDecoder(w.Body).Decode(&wh)
	if wh.ID != "wh-new" {
		t.Errorf("expected ID wh-new, got %s", wh.ID)
	}
}

func TestHandler_Delete(t *testing.T) {
	repo := &mockWebhookRepo{}
	h := NewHandler(repo)

	r := chi.NewRouter()
	r.Route("/api/v2/projects/{projectID}/webhooks", func(r chi.Router) {
		r.Mount("/", h.Routes())
	})

	req := httptest.NewRequest(http.MethodDelete, "/api/v2/projects/proj-1/webhooks/wh-1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", w.Code)
	}
}
