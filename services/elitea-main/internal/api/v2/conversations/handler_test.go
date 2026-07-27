package conversations_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/conversations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

// mockRepo implements conversations.Repository for testing.
type mockRepo struct {
	listFn                    func(ctx context.Context, projectID string, page, pageSize int) (conversations.ListResponse, error)
	getFn                     func(ctx context.Context, projectID, conversationID string) (conversations.Conversation, error)
	createFn                  func(ctx context.Context, projectID string, conv conversations.Conversation) (conversations.Conversation, error)
	updateFn                  func(ctx context.Context, projectID, conversationID string, conv conversations.Conversation) (conversations.Conversation, error)
	deleteFn                  func(ctx context.Context, projectID, conversationID string) error
	listMessagesFn            func(ctx context.Context, projectID, conversationID string, page, pageSize int) (conversations.MessagesListResponse, error)
	addParticipantFn          func(ctx context.Context, projectID, conversationID string, body map[string]any) error
	removeParticipantFn       func(ctx context.Context, projectID, conversationID, participantID string) error
	updateEntitySettingsFn    func(ctx context.Context, projectID, conversationID, participantID string, settings map[string]any) error
	batchUpdateEntitySettings func(ctx context.Context, projectID, conversationID string, settings []map[string]any) error
	selectConversationFn      func(ctx context.Context, projectID, conversationID, userID string) error
	deselectConversationFn    func(ctx context.Context, projectID, userID string) error
	createCanvasFn            func(ctx context.Context, projectID string, body map[string]any) (map[string]any, error)
	getCanvasFn               func(ctx context.Context, projectID, canvasID string) (map[string]any, error)
	updateCanvasFn            func(ctx context.Context, projectID, canvasID string, body map[string]any) error
	updateAttachmentStorageFn func(ctx context.Context, projectID, conversationID string, body map[string]any) error
	addAttachmentsFn          func(ctx context.Context, projectID, conversationID string, body map[string]any) error
	deleteAttachmentsFn       func(ctx context.Context, projectID, conversationID string) error
	getContextAnalyticsFn     func(ctx context.Context, projectID, conversationID string) (map[string]any, error)
	updateContextStrategyFn   func(ctx context.Context, projectID, conversationID string, body map[string]any) error
	deleteMessagesFn          func(ctx context.Context, projectID, conversationID string) error
	deleteMessageFn           func(ctx context.Context, projectID, groupUID string) error
}

func (m *mockRepo) List(ctx context.Context, projectID string, page, pageSize int) (conversations.ListResponse, error) {
	return m.listFn(ctx, projectID, page, pageSize)
}

func (m *mockRepo) Get(ctx context.Context, projectID, conversationID string) (conversations.Conversation, error) {
	return m.getFn(ctx, projectID, conversationID)
}

func (m *mockRepo) Create(ctx context.Context, projectID string, conv conversations.Conversation) (conversations.Conversation, error) {
	return m.createFn(ctx, projectID, conv)
}

func (m *mockRepo) Update(ctx context.Context, projectID, conversationID string, conv conversations.Conversation) (conversations.Conversation, error) {
	return m.updateFn(ctx, projectID, conversationID, conv)
}

func (m *mockRepo) Delete(ctx context.Context, projectID, conversationID string) error {
	return m.deleteFn(ctx, projectID, conversationID)
}

func (m *mockRepo) ListMessages(ctx context.Context, projectID, conversationID string, page, pageSize int) (conversations.MessagesListResponse, error) {
	return m.listMessagesFn(ctx, projectID, conversationID, page, pageSize)
}

func (m *mockRepo) AddParticipant(ctx context.Context, projectID, conversationID string, body map[string]any) error {
	return m.addParticipantFn(ctx, projectID, conversationID, body)
}

func (m *mockRepo) RemoveParticipant(ctx context.Context, projectID, conversationID, participantID string) error {
	return m.removeParticipantFn(ctx, projectID, conversationID, participantID)
}

func (m *mockRepo) UpdateEntitySettings(ctx context.Context, projectID, conversationID, participantID string, settings map[string]any) error {
	return m.updateEntitySettingsFn(ctx, projectID, conversationID, participantID, settings)
}

func (m *mockRepo) BatchUpdateEntitySettings(ctx context.Context, projectID, conversationID string, settings []map[string]any) error {
	return m.batchUpdateEntitySettings(ctx, projectID, conversationID, settings)
}

func (m *mockRepo) SelectConversation(ctx context.Context, projectID, conversationID, userID string) error {
	return m.selectConversationFn(ctx, projectID, conversationID, userID)
}

func (m *mockRepo) DeselectConversation(ctx context.Context, projectID, userID string) error {
	return m.deselectConversationFn(ctx, projectID, userID)
}

func (m *mockRepo) CreateCanvas(ctx context.Context, projectID string, body map[string]any) (map[string]any, error) {
	return m.createCanvasFn(ctx, projectID, body)
}

func (m *mockRepo) GetCanvas(ctx context.Context, projectID, canvasID string) (map[string]any, error) {
	return m.getCanvasFn(ctx, projectID, canvasID)
}

func (m *mockRepo) UpdateCanvas(ctx context.Context, projectID, canvasID string, body map[string]any) error {
	return m.updateCanvasFn(ctx, projectID, canvasID, body)
}

func (m *mockRepo) UpdateAttachmentStorage(ctx context.Context, projectID, conversationID string, body map[string]any) error {
	return m.updateAttachmentStorageFn(ctx, projectID, conversationID, body)
}

func (m *mockRepo) AddAttachments(ctx context.Context, projectID, conversationID string, body map[string]any) error {
	return m.addAttachmentsFn(ctx, projectID, conversationID, body)
}

func (m *mockRepo) DeleteAttachments(ctx context.Context, projectID, conversationID string) error {
	return m.deleteAttachmentsFn(ctx, projectID, conversationID)
}

func (m *mockRepo) GetContextAnalytics(ctx context.Context, projectID, conversationID string) (map[string]any, error) {
	return m.getContextAnalyticsFn(ctx, projectID, conversationID)
}

func (m *mockRepo) UpdateContextStrategy(ctx context.Context, projectID, conversationID string, body map[string]any) error {
	return m.updateContextStrategyFn(ctx, projectID, conversationID, body)
}

func (m *mockRepo) DeleteMessages(ctx context.Context, projectID, conversationID string) error {
	if m.deleteMessagesFn == nil {
		return nil
	}
	return m.deleteMessagesFn(ctx, projectID, conversationID)
}

func (m *mockRepo) DeleteMessage(ctx context.Context, projectID, groupUID string) error {
	if m.deleteMessageFn == nil {
		return nil
	}
	return m.deleteMessageFn(ctx, projectID, groupUID)
}

// newRouter mounts the handler under /projects/{projectID}/conversations to
// give chi URL params their values.
func newRouter(h *conversations.Handler) chi.Router {
	r := chi.NewRouter()
	r.Route("/projects/{projectID}/conversations", func(r chi.Router) {
		r.Get("/", h.List)
		r.Post("/", h.Create)
		r.Get("/{conversationID}", h.Get)
		r.Put("/{conversationID}", h.Update)
		r.Delete("/{conversationID}", h.Delete)
		r.Get("/{conversationID}/messages", h.ListMessages)
		r.Delete("/{conversationID}/messages", h.DeleteMessages)
		r.Delete("/{conversationID}/messages/{messageID}", h.DeleteMessage)
		r.Post("/{conversationID}/participants", h.AddParticipant)
		r.Delete("/{conversationID}/participants/{participantID}", h.RemoveParticipant)
		r.Put("/{conversationID}/participants/{participantID}/settings", h.UpdateEntitySettings)
		r.Put("/{conversationID}/participants/settings/batch", h.BatchUpdateEntitySettings)
		r.Post("/{conversationID}/select", h.SelectConversation)
		r.Post("/deselect", h.DeselectConversation)
		r.Post("/{conversationID}/regenerate", h.Regenerate)
		r.Post("/canvas", h.CreateCanvas)
		r.Get("/canvas/{canvasID}", h.GetCanvas)
		r.Put("/canvas/{canvasID}", h.UpdateCanvas)
		r.Put("/{conversationID}/attachment-storage", h.UpdateAttachmentStorage)
		r.Post("/{conversationID}/attachments", h.AddAttachments)
		r.Delete("/{conversationID}/attachments", h.DeleteAttachments)
		r.Get("/{conversationID}/context-analytics", h.GetContextAnalytics)
		r.Put("/{conversationID}/context-strategy", h.UpdateContextStrategy)
	})
	return r
}

var errRepo = errors.New("repo error")

func fixedTime() time.Time {
	return time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

func TestList_Success(t *testing.T) {
	repo := &mockRepo{
		listFn: func(_ context.Context, projectID string, page, pageSize int) (conversations.ListResponse, error) {
			return conversations.ListResponse{
				Items:      []conversations.Conversation{{ID: "c1", ProjectID: projectID}},
				Total:      1,
				Page:       page,
				PageSize:   pageSize,
				TotalPages: 1,
			}, nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/proj-1/conversations/?page=1&page_size=10", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp conversations.ListResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Items) != 1 || resp.Items[0].ID != "c1" {
		t.Errorf("unexpected response: %+v", resp)
	}
}

func TestList_Error(t *testing.T) {
	repo := &mockRepo{
		listFn: func(_ context.Context, _ string, _, _ int) (conversations.ListResponse, error) {
			return conversations.ListResponse{}, errRepo
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/proj-1/conversations/", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestList_DefaultPagination(t *testing.T) {
	var gotPage, gotPageSize int
	repo := &mockRepo{
		listFn: func(_ context.Context, _ string, page, pageSize int) (conversations.ListResponse, error) {
			gotPage = page
			gotPageSize = pageSize
			return conversations.ListResponse{}, nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/proj-1/conversations/", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if gotPage != 1 || gotPageSize != 20 {
		t.Errorf("expected page=1 pageSize=20, got page=%d pageSize=%d", gotPage, gotPageSize)
	}
}

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

func TestGet_Success(t *testing.T) {
	repo := &mockRepo{
		getFn: func(_ context.Context, projectID, conversationID string) (conversations.Conversation, error) {
			return conversations.Conversation{ID: conversationID, ProjectID: projectID, Name: "test"}, nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/proj-1/conversations/conv-1", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var conv conversations.Conversation
	if err := json.NewDecoder(w.Body).Decode(&conv); err != nil {
		t.Fatal(err)
	}
	if conv.ID != "conv-1" {
		t.Errorf("expected conv-1, got %s", conv.ID)
	}
}

func TestGet_NotFound(t *testing.T) {
	repo := &mockRepo{
		getFn: func(_ context.Context, _, _ string) (conversations.Conversation, error) {
			return conversations.Conversation{}, errRepo
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/proj-1/conversations/conv-x", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

func TestCreate_Success(t *testing.T) {
	repo := &mockRepo{
		createFn: func(_ context.Context, projectID string, conv conversations.Conversation) (conversations.Conversation, error) {
			conv.ID = "new-conv"
			conv.ProjectID = projectID
			conv.CreatedAt = fixedTime()
			conv.UpdatedAt = fixedTime()
			return conv, nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	body, _ := json.Marshal(conversations.Conversation{Name: "My Conv"})
	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", w.Code)
	}
	var conv conversations.Conversation
	if err := json.NewDecoder(w.Body).Decode(&conv); err != nil {
		t.Fatal(err)
	}
	if conv.ID != "new-conv" {
		t.Errorf("expected new-conv, got %s", conv.ID)
	}
}

func TestCreate_InvalidBody(t *testing.T) {
	repo := &mockRepo{}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/", bytes.NewBufferString("not json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreate_RepoError(t *testing.T) {
	repo := &mockRepo{
		createFn: func(_ context.Context, _ string, _ conversations.Conversation) (conversations.Conversation, error) {
			return conversations.Conversation{}, errRepo
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	body, _ := json.Marshal(conversations.Conversation{Name: "conv"})
	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

func TestUpdate_Success(t *testing.T) {
	repo := &mockRepo{
		updateFn: func(_ context.Context, projectID, conversationID string, conv conversations.Conversation) (conversations.Conversation, error) {
			conv.ID = conversationID
			conv.ProjectID = projectID
			return conv, nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	body, _ := json.Marshal(conversations.Conversation{Name: "Updated"})
	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/conv-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var conv conversations.Conversation
	if err := json.NewDecoder(w.Body).Decode(&conv); err != nil {
		t.Fatal(err)
	}
	if conv.Name != "Updated" {
		t.Errorf("expected Updated, got %s", conv.Name)
	}
}

func TestUpdate_InvalidBody(t *testing.T) {
	repo := &mockRepo{}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/conv-1", bytes.NewBufferString("{bad"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdate_RepoError(t *testing.T) {
	repo := &mockRepo{
		updateFn: func(_ context.Context, _, _ string, _ conversations.Conversation) (conversations.Conversation, error) {
			return conversations.Conversation{}, errRepo
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	body, _ := json.Marshal(conversations.Conversation{Name: "conv"})
	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/conv-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

func TestDelete_Success(t *testing.T) {
	repo := &mockRepo{
		deleteFn: func(_ context.Context, _, _ string) error { return nil },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/projects/proj-1/conversations/conv-1", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", w.Code)
	}
}

func TestDelete_Error(t *testing.T) {
	repo := &mockRepo{
		deleteFn: func(_ context.Context, _, _ string) error { return errRepo },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/projects/proj-1/conversations/conv-1", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// ListMessages
// ---------------------------------------------------------------------------

func TestListMessages_Success(t *testing.T) {
	repo := &mockRepo{
		listMessagesFn: func(_ context.Context, projectID, conversationID string, page, pageSize int) (conversations.MessagesListResponse, error) {
			return conversations.MessagesListResponse{
				Items:    []conversations.Message{{ID: "m1", ConversationID: conversationID}},
				Total:    1,
				Page:     page,
				PageSize: pageSize,
			}, nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/proj-1/conversations/conv-1/messages", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp conversations.MessagesListResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Items) != 1 || resp.Items[0].ID != "m1" {
		t.Errorf("unexpected response: %+v", resp)
	}
}

func TestListMessages_DefaultPagination(t *testing.T) {
	var gotPage, gotPageSize int
	repo := &mockRepo{
		listMessagesFn: func(_ context.Context, _, _ string, page, pageSize int) (conversations.MessagesListResponse, error) {
			gotPage = page
			gotPageSize = pageSize
			return conversations.MessagesListResponse{}, nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/proj-1/conversations/conv-1/messages", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if gotPage != 1 || gotPageSize != 50 {
		t.Errorf("expected page=1 pageSize=50, got page=%d pageSize=%d", gotPage, gotPageSize)
	}
}

func TestListMessages_Error(t *testing.T) {
	repo := &mockRepo{
		listMessagesFn: func(_ context.Context, _, _ string, _, _ int) (conversations.MessagesListResponse, error) {
			return conversations.MessagesListResponse{}, errRepo
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/proj-1/conversations/conv-1/messages", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// DeleteMessages (stub - no repo call)
// ---------------------------------------------------------------------------

func TestDeleteMessages_Success(t *testing.T) {
	h := conversations.NewHandler(&mockRepo{})
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/projects/proj-1/conversations/conv-1/messages", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// DeleteMessage (stub - no repo call)
// ---------------------------------------------------------------------------

func TestDeleteMessage_Success(t *testing.T) {
	h := conversations.NewHandler(&mockRepo{})
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/projects/proj-1/conversations/conv-1/messages/msg-1", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// AddParticipant
// ---------------------------------------------------------------------------

func TestAddParticipant_Success(t *testing.T) {
	repo := &mockRepo{
		addParticipantFn: func(_ context.Context, _, _ string, _ map[string]any) error { return nil },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	body, _ := json.Marshal(map[string]any{"user_id": "u-1"})
	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/conv-1/participants", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestAddParticipant_Error(t *testing.T) {
	repo := &mockRepo{
		addParticipantFn: func(_ context.Context, _, _ string, _ map[string]any) error { return errRepo },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/conv-1/participants", bytes.NewBufferString("{}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// RemoveParticipant
// ---------------------------------------------------------------------------

func TestRemoveParticipant_Success(t *testing.T) {
	var gotParticipantID string
	repo := &mockRepo{
		removeParticipantFn: func(_ context.Context, _, _, participantID string) error {
			gotParticipantID = participantID
			return nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/projects/proj-1/conversations/conv-1/participants/part-1", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if gotParticipantID != "part-1" {
		t.Errorf("expected part-1, got %s", gotParticipantID)
	}
}

func TestRemoveParticipant_Error(t *testing.T) {
	repo := &mockRepo{
		removeParticipantFn: func(_ context.Context, _, _, _ string) error { return errRepo },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/projects/proj-1/conversations/conv-1/participants/part-1", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// UpdateEntitySettings
// ---------------------------------------------------------------------------

func TestUpdateEntitySettings_Success(t *testing.T) {
	repo := &mockRepo{
		updateEntitySettingsFn: func(_ context.Context, _, _, _ string, _ map[string]any) error { return nil },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	body, _ := json.Marshal(map[string]any{"key": "val"})
	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/conv-1/participants/part-1/settings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestUpdateEntitySettings_Error(t *testing.T) {
	repo := &mockRepo{
		updateEntitySettingsFn: func(_ context.Context, _, _, _ string, _ map[string]any) error { return errRepo },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/conv-1/participants/part-1/settings", bytes.NewBufferString("{}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// BatchUpdateEntitySettings
// ---------------------------------------------------------------------------

func TestBatchUpdateEntitySettings_Success(t *testing.T) {
	repo := &mockRepo{
		batchUpdateEntitySettings: func(_ context.Context, _, _ string, _ []map[string]any) error { return nil },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	body, _ := json.Marshal([]map[string]any{{"id": "p1", "key": "val"}})
	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/conv-1/participants/settings/batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestBatchUpdateEntitySettings_Error(t *testing.T) {
	repo := &mockRepo{
		batchUpdateEntitySettings: func(_ context.Context, _, _ string, _ []map[string]any) error { return errRepo },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/conv-1/participants/settings/batch", bytes.NewBufferString("[]"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// SelectConversation
// ---------------------------------------------------------------------------

func TestSelectConversation_Success(t *testing.T) {
	var gotUserID string
	repo := &mockRepo{
		selectConversationFn: func(_ context.Context, _, _, userID string) error {
			gotUserID = userID
			return nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/conv-1/select", nil)
	ctx := auth.ContextWithUser(req.Context(), auth.User{ID: "user-1", Email: "test@test.com"})
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if gotUserID != "user-1" {
		t.Errorf("expected user-1, got %s", gotUserID)
	}
}

func TestSelectConversation_Error(t *testing.T) {
	repo := &mockRepo{
		selectConversationFn: func(_ context.Context, _, _, _ string) error { return errRepo },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/conv-1/select", nil)
	ctx := auth.ContextWithUser(req.Context(), auth.User{ID: "user-1", Email: "test@test.com"})
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// DeselectConversation
// ---------------------------------------------------------------------------

func TestDeselectConversation_Success(t *testing.T) {
	var gotUserID string
	repo := &mockRepo{
		deselectConversationFn: func(_ context.Context, _, userID string) error {
			gotUserID = userID
			return nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/deselect", nil)
	ctx := auth.ContextWithUser(req.Context(), auth.User{ID: "user-1", Email: "test@test.com"})
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if gotUserID != "user-1" {
		t.Errorf("expected user-1, got %s", gotUserID)
	}
}

func TestDeselectConversation_Error(t *testing.T) {
	repo := &mockRepo{
		deselectConversationFn: func(_ context.Context, _, _ string) error { return errRepo },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/deselect", nil)
	ctx := auth.ContextWithUser(req.Context(), auth.User{ID: "user-1", Email: "test@test.com"})
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// Regenerate (stub - no repo call)
// ---------------------------------------------------------------------------

func TestRegenerate_Success(t *testing.T) {
	h := conversations.NewHandler(&mockRepo{})
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/conv-1/regenerate", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// CreateCanvas
// ---------------------------------------------------------------------------

func TestCreateCanvas_Success(t *testing.T) {
	repo := &mockRepo{
		createCanvasFn: func(_ context.Context, _ string, body map[string]any) (map[string]any, error) {
			body["id"] = "canvas-1"
			return body, nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	body, _ := json.Marshal(map[string]any{"title": "My Canvas"})
	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/canvas", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", w.Code)
	}
	var result map[string]any
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result["id"] != "canvas-1" {
		t.Errorf("expected canvas-1, got %v", result["id"])
	}
}

func TestCreateCanvas_Error(t *testing.T) {
	repo := &mockRepo{
		createCanvasFn: func(_ context.Context, _ string, _ map[string]any) (map[string]any, error) {
			return nil, errRepo
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/canvas", bytes.NewBufferString("{}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// GetCanvas
// ---------------------------------------------------------------------------

func TestGetCanvas_Success(t *testing.T) {
	repo := &mockRepo{
		getCanvasFn: func(_ context.Context, _, canvasID string) (map[string]any, error) {
			return map[string]any{"id": canvasID, "title": "Canvas"}, nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/proj-1/conversations/canvas/canvas-1", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var result map[string]any
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result["id"] != "canvas-1" {
		t.Errorf("expected canvas-1, got %v", result["id"])
	}
}

func TestGetCanvas_Error(t *testing.T) {
	repo := &mockRepo{
		getCanvasFn: func(_ context.Context, _, _ string) (map[string]any, error) {
			return nil, errRepo
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/proj-1/conversations/canvas/canvas-x", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// UpdateCanvas
// ---------------------------------------------------------------------------

func TestUpdateCanvas_Success(t *testing.T) {
	repo := &mockRepo{
		updateCanvasFn: func(_ context.Context, _, _ string, _ map[string]any) error { return nil },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	body, _ := json.Marshal(map[string]any{"title": "Updated"})
	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/canvas/canvas-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestUpdateCanvas_Error(t *testing.T) {
	repo := &mockRepo{
		updateCanvasFn: func(_ context.Context, _, _ string, _ map[string]any) error { return errRepo },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/canvas/canvas-1", bytes.NewBufferString("{}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// UpdateAttachmentStorage
// ---------------------------------------------------------------------------

func TestUpdateAttachmentStorage_Success(t *testing.T) {
	repo := &mockRepo{
		updateAttachmentStorageFn: func(_ context.Context, _, _ string, _ map[string]any) error { return nil },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	body, _ := json.Marshal(map[string]any{"bucket": "s3://test"})
	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/conv-1/attachment-storage", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestUpdateAttachmentStorage_Error(t *testing.T) {
	repo := &mockRepo{
		updateAttachmentStorageFn: func(_ context.Context, _, _ string, _ map[string]any) error { return errRepo },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/conv-1/attachment-storage", bytes.NewBufferString("{}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// AddAttachments
// ---------------------------------------------------------------------------

func TestAddAttachments_Success(t *testing.T) {
	repo := &mockRepo{
		addAttachmentsFn: func(_ context.Context, _, _ string, _ map[string]any) error { return nil },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	body, _ := json.Marshal(map[string]any{"files": []string{"file1.txt"}})
	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/conv-1/attachments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestAddAttachments_Error(t *testing.T) {
	repo := &mockRepo{
		addAttachmentsFn: func(_ context.Context, _, _ string, _ map[string]any) error { return errRepo },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/projects/proj-1/conversations/conv-1/attachments", bytes.NewBufferString("{}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// DeleteAttachments
// ---------------------------------------------------------------------------

func TestDeleteAttachments_Success(t *testing.T) {
	repo := &mockRepo{
		deleteAttachmentsFn: func(_ context.Context, _, _ string) error { return nil },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/projects/proj-1/conversations/conv-1/attachments", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestDeleteAttachments_Error(t *testing.T) {
	repo := &mockRepo{
		deleteAttachmentsFn: func(_ context.Context, _, _ string) error { return errRepo },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/projects/proj-1/conversations/conv-1/attachments", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// GetContextAnalytics
// ---------------------------------------------------------------------------

func TestGetContextAnalytics_Success(t *testing.T) {
	repo := &mockRepo{
		getContextAnalyticsFn: func(_ context.Context, _, _ string) (map[string]any, error) {
			return map[string]any{"token_count": 42, "max_tokens": 128000}, nil
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/proj-1/conversations/conv-1/context-analytics", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var result map[string]any
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result["token_count"].(float64) != 42 {
		t.Errorf("expected token_count=42, got %v", result["token_count"])
	}
}

// GetContextAnalytics falls back to defaults on repo error (not an HTTP error).
func TestGetContextAnalytics_ErrorFallback(t *testing.T) {
	repo := &mockRepo{
		getContextAnalyticsFn: func(_ context.Context, _, _ string) (map[string]any, error) {
			return nil, errRepo
		},
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/proj-1/conversations/conv-1/context-analytics", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Handler returns 200 with default values even on error.
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var result map[string]any
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result["token_count"].(float64) != 0 {
		t.Errorf("expected default token_count=0, got %v", result["token_count"])
	}
}

// ---------------------------------------------------------------------------
// UpdateContextStrategy
// ---------------------------------------------------------------------------

func TestUpdateContextStrategy_Success(t *testing.T) {
	repo := &mockRepo{
		updateContextStrategyFn: func(_ context.Context, _, _ string, _ map[string]any) error { return nil },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	body, _ := json.Marshal(map[string]any{"strategy": "summarize"})
	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/conv-1/context-strategy", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestUpdateContextStrategy_Error(t *testing.T) {
	repo := &mockRepo{
		updateContextStrategyFn: func(_ context.Context, _, _ string, _ map[string]any) error { return errRepo },
	}
	h := conversations.NewHandler(repo)
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodPut, "/projects/proj-1/conversations/conv-1/context-strategy", bytes.NewBufferString("{}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}
