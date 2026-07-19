package eliteacore_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/eliteacore"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type permissionResolverFunc func(
	context.Context,
	auth.User,
	string,
	string,
) (auth.PermissionResolution, error)

func (f permissionResolverFunc) ResolvePermissions(
	ctx context.Context,
	principal auth.User,
	mode string,
	projectID string,
) (auth.PermissionResolution, error) {
	return f(ctx, principal, mode, projectID)
}

// newHandler creates a Handler with a nil pool. Safe only for static handlers
// (those that never dereference h.pool).
func newHandler() *eliteacore.Handler {
	return eliteacore.NewHandler(nil)
}

// newRequest builds an httptest.Request with optional chi URL params and body.
func newRequest(method, target string, params map[string]string, body io.Reader) *http.Request {
	req := httptest.NewRequest(method, target, body)
	if len(params) > 0 {
		rctx := chi.NewRouteContext()
		for k, v := range params {
			rctx.URLParams.Add(k, v)
		}
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	}
	return req
}

// decodeObj decodes the response body into a map[string]any.
func decodeObj(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.NewDecoder(w.Body).Decode(&out); err != nil {
		t.Fatalf("failed to decode JSON object response: %v", err)
	}
	return out
}

// decodeArr decodes the response body into a []any.
func decodeArr(t *testing.T, w *httptest.ResponseRecorder) []any {
	t.Helper()
	var out []any
	if err := json.NewDecoder(w.Body).Decode(&out); err != nil {
		t.Fatalf("failed to decode JSON array response: %v", err)
	}
	return out
}

func assertStatus(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Errorf("status: want %d, got %d", want, w.Code)
	}
}

func assertContentTypeJSON(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type: want application/json, got %q", ct)
	}
}

// ---- PlatformSettings -------------------------------------------------------

func TestPlatformSettings(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.PlatformSettings(w, httptest.NewRequest(http.MethodGet, "/", nil))

	assertStatus(t, w, http.StatusOK)
	assertContentTypeJSON(t, w)

	body := decodeObj(t, w)

	// All expected keys must be present.
	for _, key := range []string{
		"chat_enabled", "applications_enabled", "skills_enabled",
		"toolkits_enabled", "datasources_enabled", "pipelines_enabled",
		"publishing_enabled", "moderation_enabled", "mcp_enabled",
		"support_chat_enabled",
	} {
		if _, ok := body[key]; !ok {
			t.Errorf("missing key %q", key)
		}
	}

	// Features that should be enabled.
	for _, key := range []string{"chat_enabled", "applications_enabled", "skills_enabled", "toolkits_enabled", "datasources_enabled"} {
		if v, _ := body[key].(bool); !v {
			t.Errorf("%s should be true", key)
		}
	}

	// Features that should be disabled.
	for _, key := range []string{"moderation_enabled", "support_chat_enabled"} {
		if v, _ := body[key].(bool); v {
			t.Errorf("%s should be false", key)
		}
	}
}

// ---- ProjectContext / UpdateProjectContext ----------------------------------

func TestProjectContext(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.ProjectContext(w, httptest.NewRequest(http.MethodGet, "/", nil))

	assertStatus(t, w, http.StatusOK)
	assertContentTypeJSON(t, w)

	body := decodeObj(t, w)
	if _, ok := body["content"]; !ok {
		t.Error("response must contain 'content' key")
	}
	if body["content"] != "" {
		t.Errorf("content should be empty string, got %q", body["content"])
	}
}

func TestUpdateProjectContext(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.UpdateProjectContext(w, httptest.NewRequest(http.MethodPut, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if ok, _ := body["ok"].(bool); !ok {
		t.Error("ok should be true")
	}
}

// ---- Notifications ----------------------------------------------------------

func TestNotifications(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.Notifications(w, httptest.NewRequest(http.MethodGet, "/", nil))

	assertStatus(t, w, http.StatusOK)
	assertContentTypeJSON(t, w)

	body := decodeObj(t, w)
	if _, ok := body["notifications"]; !ok {
		t.Error("response must contain 'notifications' key")
	}
	if total, _ := body["total"].(float64); total != 0 {
		t.Errorf("total should be 0, got %v", body["total"])
	}
}

// ---- PublicApplications / TrendingAuthors -----------------------------------

func TestPublicApplications(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.PublicApplications(w, httptest.NewRequest(http.MethodGet, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if _, ok := body["rows"]; !ok {
		t.Error("response must contain 'rows' key")
	}
	if total, _ := body["total"].(float64); total != 0 {
		t.Errorf("total should be 0, got %v", body["total"])
	}
}

func TestTrendingAuthors(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.TrendingAuthors(w, httptest.NewRequest(http.MethodGet, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if _, ok := body["items"]; !ok {
		t.Error("response must contain 'items' key")
	}
	if total, _ := body["total"].(float64); total != 0 {
		t.Errorf("total should be 0, got %v", body["total"])
	}
}

// ---- ModerationStatus -------------------------------------------------------

func TestModerationStatus(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.ModerationStatus(w, httptest.NewRequest(http.MethodGet, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if status, _ := body["status"].(string); status != "approved" {
		t.Errorf("status: want 'approved', got %q", status)
	}
}

// ---- Permissions ------------------------------------------------------------

func TestPermissions_NoAuth_ReturnsEmptyArray(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.Permissions(w, httptest.NewRequest(http.MethodGet, "/", nil))

	assertStatus(t, w, http.StatusOK)
	assertContentTypeJSON(t, w)

	items := decodeArr(t, w)
	if len(items) != 0 {
		t.Errorf("expected empty array without auth, got %d items", len(items))
	}
}

func TestPermissions_WithAuth_ReturnsPermissionList(t *testing.T) {
	resolver := permissionResolverFunc(func(
		_ context.Context,
		principal auth.User,
		mode string,
		projectID string,
	) (auth.PermissionResolution, error) {
		if principal.ID != "1" || mode != auth.PermissionModeDefault || projectID != "7" {
			t.Fatalf("unexpected resolver input: principal=%+v mode=%q project=%q", principal, mode, projectID)
		}
		return auth.PermissionResolution{UserID: 1, Permissions: []string{"configurations.configurations.list"}}, nil
	})
	h := eliteacore.NewHandler(nil, eliteacore.WithPermissionResolver(resolver))
	req := newRequest(http.MethodGet, "/", map[string]string{"projectID": "7"}, nil)
	req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{
		ID:    "1",
		Email: "test@test.com",
	}))
	w := httptest.NewRecorder()
	h.Permissions(w, req)

	assertStatus(t, w, http.StatusOK)
	assertContentTypeJSON(t, w)

	items := decodeArr(t, w)
	if len(items) != 1 {
		t.Fatalf("expected one resolved permission, got %d", len(items))
	}

	for i, item := range items {
		perm, ok := item.(map[string]any)
		if !ok {
			t.Errorf("permission[%d] is not an object", i)
			continue
		}
		name, hasName := perm["name"].(string)
		if !hasName || name == "" {
			t.Errorf("permission[%d] missing or empty 'name'", i)
		}
		if name != "configurations.configurations.list" {
			t.Errorf("permission[%d] name = %q", i, name)
		}
		enabled, hasEnabled := perm["enabled"].(bool)
		if !hasEnabled {
			t.Errorf("permission[%d] missing 'enabled'", i)
		} else if !enabled {
			t.Errorf("permission[%d] (%q) should be enabled", i, name)
		}
	}
}

// ---- DefaultIcons -----------------------------------------------------------

func TestDefaultIcons(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.DefaultIcons(w, httptest.NewRequest(http.MethodGet, "/", nil))

	assertStatus(t, w, http.StatusOK)
	assertContentTypeJSON(t, w)

	body := decodeObj(t, w)
	items, ok := body["items"].([]any)
	if !ok {
		t.Fatal("response must contain 'items' array")
	}
	const wantCount = 5
	if len(items) != wantCount {
		t.Errorf("expected %d icons, got %d", wantCount, len(items))
	}
	if total, _ := body["total"].(float64); int(total) != wantCount {
		t.Errorf("total: want %d, got %v", wantCount, body["total"])
	}

	for i, raw := range items {
		icon, ok := raw.(map[string]any)
		if !ok {
			t.Errorf("icon[%d] is not an object", i)
			continue
		}
		if name, _ := icon["name"].(string); name == "" {
			t.Errorf("icon[%d] missing or empty 'name'", i)
		}
		if url, _ := icon["url"].(string); url == "" {
			t.Errorf("icon[%d] missing or empty 'url'", i)
		}
	}
}

// ---- UploadIcon -------------------------------------------------------------

func TestUploadIcon(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.UploadIcon(w, httptest.NewRequest(http.MethodPost, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if ok, _ := body["ok"].(bool); !ok {
		t.Error("ok should be true")
	}
	if _, hasURL := body["url"]; !hasURL {
		t.Error("response must contain 'url' key")
	}
}

// ---- Export / Import --------------------------------------------------------

func TestExportImportPost(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.ExportImportPost(w, httptest.NewRequest(http.MethodPost, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if ok, _ := body["ok"].(bool); !ok {
		t.Error("ok should be true")
	}
}

func TestExportImportGet(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.ExportImportGet(w, httptest.NewRequest(http.MethodGet, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if ok, _ := body["ok"].(bool); !ok {
		t.Error("ok should be true")
	}
}

func TestExportConverter(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.ExportConverter(w, httptest.NewRequest(http.MethodPost, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if ok, _ := body["ok"].(bool); !ok {
		t.Error("ok should be true")
	}
}

// ---- UpdateNotification -----------------------------------------------------

func TestUpdateNotification(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.UpdateNotification(w, httptest.NewRequest(http.MethodPut, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if ok, _ := body["ok"].(bool); !ok {
		t.Error("ok should be true")
	}
}

// ---- Project Icons ----------------------------------------------------------

func TestListProjectIcons(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.ListProjectIcons(w, httptest.NewRequest(http.MethodGet, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if _, ok := body["items"]; !ok {
		t.Error("response must contain 'items' key")
	}
	if total, _ := body["total"].(float64); total != 0 {
		t.Errorf("total should be 0, got %v", body["total"])
	}
}

func TestCreateProjectIcon(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.CreateProjectIcon(w, httptest.NewRequest(http.MethodPost, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	name, nameOK := body["name"].(string)
	if !nameOK || name == "" {
		t.Error("response should contain a generated icon name")
	}
	url, urlOK := body["url"].(string)
	if !urlOK || url != "/app/project_icon//"+name {
		t.Errorf("url = %q, want generated icon URL", url)
	}
}

func TestDeleteProjectIcon(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.DeleteProjectIcon(w, httptest.NewRequest(http.MethodDelete, "/", nil))

	assertStatus(t, w, http.StatusNoContent)
}

// ---- MCP Proxies ------------------------------------------------------------

func TestMCPOAuthProxy(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.MCPOAuthProxy(w, httptest.NewRequest(http.MethodPost, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if ok, _ := body["ok"].(bool); !ok {
		t.Error("ok should be true")
	}
}

func TestMCPDCRProxy(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.MCPDCRProxy(w, httptest.NewRequest(http.MethodPost, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if ok, _ := body["ok"].(bool); !ok {
		t.Error("ok should be true")
	}
}

// ---- SupportConfig ----------------------------------------------------------

func TestSupportConfig(t *testing.T) {
	h := newHandler()
	w := httptest.NewRecorder()
	h.SupportConfig(w, httptest.NewRequest(http.MethodGet, "/", nil))

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if _, ok := body["enabled"]; !ok {
		t.Error("response must contain 'enabled' key")
	}
	if enabled, _ := body["enabled"].(bool); enabled {
		t.Error("enabled should be false")
	}
}

// ---- UpdateProjectInfo (no pool access when name is absent/empty) -----------

func TestUpdateProjectInfo_NoBody(t *testing.T) {
	h := newHandler()
	req := newRequest(http.MethodPut, "/", map[string]string{"projectID": "proj-1"}, nil)
	w := httptest.NewRecorder()
	h.UpdateProjectInfo(w, req)

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if ok, _ := body["ok"].(bool); !ok {
		t.Error("ok should be true")
	}
}

func TestUpdateProjectInfo_EmptyName(t *testing.T) {
	// name = "" means the pool.Exec branch is skipped entirely.
	payload := strings.NewReader(`{"name":""}`)
	req := newRequest(http.MethodPut, "/", map[string]string{"projectID": "proj-1"}, payload)
	w := httptest.NewRecorder()
	newHandler().UpdateProjectInfo(w, req)

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if ok, _ := body["ok"].(bool); !ok {
		t.Error("ok should be true")
	}
}

// ---- DB-dependent methods: compile-time existence check --------------------
//
// Handlers below require a live pgxpool.Pool. Calling them with a nil pool
// panics inside pgx before any error-handling code can run.  The test below
// is a compile-time assertion: if any method is removed or renamed the build
// fails, giving us a regression signal without needing a real database.

func TestDBHandlerMethodsExist(t *testing.T) {
	h := eliteacore.NewHandler(nil)

	// Assign every DB-dependent method to the same function-type slice.
	// The compiler rejects the assignment if a method signature changes.
	_ = []func(http.ResponseWriter, *http.Request){
		h.ProjectInfo,
		h.SearchOptions,
		h.Users,
		h.Roles,
		h.ChatConfig,
		h.Author,
		h.Publish,
		h.Unpublish,
		h.PublishValidate,
		h.VersionValidator,
		h.Recommendations,
		h.Feedbacks,
		h.Pin,
		h.Unpin,
		h.ApplicationRelation,
	}
	// If we reach this line, all method signatures are correct.
}
