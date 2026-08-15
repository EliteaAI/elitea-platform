package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

// fakeResolver is a stub PersonalProjectResolver for middleware tests.
type fakeResolver struct {
	id     int
	err    error
	called bool
	gotUID string
}

func (f *fakeResolver) PersonalProjectID(_ context.Context, userID string) (int, error) {
	f.called = true
	f.gotUID = userID
	return f.id, f.err
}

// captureHandler records whether next was invoked and what project context it saw.
func captureHandler(seen *ProjectContext, invoked *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*invoked = true
		if pc, ok := ProjectFromContext(r.Context()); ok {
			*seen = pc
		}
		w.WriteHeader(http.StatusOK)
	})
}

func TestProject_SystemProjectUserName(t *testing.T) {
	resolver := &fakeResolver{id: 999} // must NOT be consulted for system names
	var seen ProjectContext
	var invoked bool

	mw := Project(ProjectConfig{Resolver: resolver, PublicProjectID: 1})
	h := mw(captureHandler(&seen, &invoked))

	req := httptest.NewRequest(http.MethodGet, "/llm/v1/models", nil)
	user := auth.User{ID: "42", Name: ":system:project:7:", AuthType: "token"}
	req = req.WithContext(auth.ContextWithUser(req.Context(), user))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !invoked {
		t.Fatal("next handler was not invoked")
	}
	if resolver.called {
		t.Error("resolver must not be called for system project-user names")
	}
	if seen.ProjectID != 7 {
		t.Errorf("expected project id 7, got %d", seen.ProjectID)
	}
	if seen.PublicProjectID != 1 {
		t.Errorf("expected public project id 1, got %d", seen.PublicProjectID)
	}
}

func TestProject_PersonalProjectFallback(t *testing.T) {
	resolver := &fakeResolver{id: 55}
	var seen ProjectContext
	var invoked bool

	mw := Project(ProjectConfig{Resolver: resolver, PublicProjectID: 3})
	h := mw(captureHandler(&seen, &invoked))

	req := httptest.NewRequest(http.MethodGet, "/llm/v1/models", nil)
	user := auth.User{ID: "42", Name: "Regular User", AuthType: "token"}
	req = req.WithContext(auth.ContextWithUser(req.Context(), user))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !resolver.called {
		t.Error("resolver should be called for non-system names")
	}
	if resolver.gotUID != "42" {
		t.Errorf("resolver got uid %q, want 42", resolver.gotUID)
	}
	if seen.ProjectID != 55 {
		t.Errorf("expected project id 55, got %d", seen.ProjectID)
	}
	if seen.PublicProjectID != 3 {
		t.Errorf("expected public project id 3, got %d", seen.PublicProjectID)
	}
}

func TestProject_NoUser_PassesThrough(t *testing.T) {
	resolver := &fakeResolver{id: 1}
	var seen ProjectContext
	var invoked bool

	mw := Project(ProjectConfig{Resolver: resolver, PublicProjectID: 1})
	h := mw(captureHandler(&seen, &invoked))

	req := httptest.NewRequest(http.MethodGet, "/llm/v1/models", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !invoked {
		t.Fatal("next handler should be invoked when there is no auth user")
	}
	if resolver.called {
		t.Error("resolver should not be consulted without an auth user")
	}
	if (seen != ProjectContext{}) {
		t.Errorf("expected no project context injected, got %+v", seen)
	}
}

func TestProject_UnresolvableProject_Returns400(t *testing.T) {
	resolver := &fakeResolver{id: 0} // cannot resolve
	var seen ProjectContext
	var invoked bool

	mw := Project(ProjectConfig{Resolver: resolver, PublicProjectID: 1})
	h := mw(captureHandler(&seen, &invoked))

	req := httptest.NewRequest(http.MethodGet, "/llm/v1/models", nil)
	user := auth.User{ID: "42", Name: "Regular User"}
	req = req.WithContext(auth.ContextWithUser(req.Context(), user))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	assertProjectJSONErrorBody(t, rec.Body.Bytes())
	if invoked {
		t.Error("next handler must not be invoked when project is unresolvable")
	}
}

func TestProject_ResolverError_Returns400(t *testing.T) {
	resolver := &fakeResolver{err: errors.New("db down")}
	var seen ProjectContext
	var invoked bool

	mw := Project(ProjectConfig{Resolver: resolver, PublicProjectID: 1})
	h := mw(captureHandler(&seen, &invoked))

	req := httptest.NewRequest(http.MethodGet, "/llm/v1/models", nil)
	user := auth.User{ID: "42", Name: "Regular User"}
	req = req.WithContext(auth.ContextWithUser(req.Context(), user))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	assertProjectJSONErrorBody(t, rec.Body.Bytes())
	if invoked {
		t.Error("next handler must not be invoked on resolver error")
	}
}

func TestProject_NilResolver_NonSystemUser_Returns400(t *testing.T) {
	var seen ProjectContext
	var invoked bool

	mw := Project(ProjectConfig{Resolver: nil, PublicProjectID: 1})
	h := mw(captureHandler(&seen, &invoked))

	req := httptest.NewRequest(http.MethodGet, "/llm/v1/models", nil)
	user := auth.User{ID: "42", Name: "Regular User"}
	req = req.WithContext(auth.ContextWithUser(req.Context(), user))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when resolver is nil and name is non-system, got %d", rec.Code)
	}
}

func TestProject_NilResolver_SystemUser_OK(t *testing.T) {
	var seen ProjectContext
	var invoked bool

	mw := Project(ProjectConfig{Resolver: nil, PublicProjectID: 1})
	h := mw(captureHandler(&seen, &invoked))

	req := httptest.NewRequest(http.MethodGet, "/llm/v1/models", nil)
	user := auth.User{ID: "42", Name: ":system:project:12:"}
	req = req.WithContext(auth.ContextWithUser(req.Context(), user))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if seen.ProjectID != 12 {
		t.Errorf("expected project id 12, got %d", seen.ProjectID)
	}
}

func TestProject_PublicProjectIDFromEnv(t *testing.T) {
	t.Setenv("AI_PROJECT_ID", "88")
	resolver := &fakeResolver{id: 5}
	var seen ProjectContext
	var invoked bool

	// PublicProjectID left zero → should be read from env.
	mw := Project(ProjectConfig{Resolver: resolver})
	h := mw(captureHandler(&seen, &invoked))

	req := httptest.NewRequest(http.MethodGet, "/llm/v1/models", nil)
	user := auth.User{ID: "42", Name: "Regular User"}
	req = req.WithContext(auth.ContextWithUser(req.Context(), user))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if seen.PublicProjectID != 88 {
		t.Errorf("expected public project id 88 from env, got %d", seen.PublicProjectID)
	}
}

func TestProject_PublicProjectIDDefault(t *testing.T) {
	t.Setenv("AI_PROJECT_ID", "")
	resolver := &fakeResolver{id: 5}
	var seen ProjectContext
	var invoked bool

	mw := Project(ProjectConfig{Resolver: resolver})
	h := mw(captureHandler(&seen, &invoked))

	req := httptest.NewRequest(http.MethodGet, "/llm/v1/models", nil)
	user := auth.User{ID: "42", Name: "Regular User"}
	req = req.WithContext(auth.ContextWithUser(req.Context(), user))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if seen.PublicProjectID != defaultPublicProjectID {
		t.Errorf("expected default public project id %d, got %d", defaultPublicProjectID, seen.PublicProjectID)
	}
}

// ---- pure-helper coverage ---------------------------------------------------

func TestProjectIDFromUserName(t *testing.T) {
	cases := []struct {
		name   string
		input  string
		wantID int
		wantOK bool
	}{
		{"valid system name", ":system:project:42:", 42, true},
		{"valid large id", ":system:project:100000:", 100000, true},
		{"non-system name", "Alice", 0, false},
		{"empty", "", 0, false},
		{"prefix but no id", ":system:project::", 0, false},
		{"prefix wrong field non-numeric", ":system:project:abc:", 0, false},
		{"zero id rejected", ":system:project:0:", 0, false},
		{"negative id rejected", ":system:project:-3:", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, ok := projectIDFromUserName(tc.input)
			if ok != tc.wantOK || id != tc.wantID {
				t.Errorf("projectIDFromUserName(%q) = (%d,%v), want (%d,%v)",
					tc.input, id, ok, tc.wantID, tc.wantOK)
			}
		})
	}
}

func TestResolveProjectID_SystemNameShortCircuits(t *testing.T) {
	resolver := &fakeResolver{id: 1}
	id, err := resolveProjectID(context.Background(), resolver, auth.User{ID: "9", Name: ":system:project:5:"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != 5 {
		t.Errorf("expected 5, got %d", id)
	}
	if resolver.called {
		t.Error("resolver must not be consulted for system names")
	}
}

func TestResolveProjectID_NilResolverNonSystem(t *testing.T) {
	id, err := resolveProjectID(context.Background(), nil, auth.User{ID: "9", Name: "Bob"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != 0 {
		t.Errorf("expected 0 with nil resolver, got %d", id)
	}
}

func TestContextWithProject_RoundTrip(t *testing.T) {
	ctx := ContextWithProject(context.Background(), ProjectContext{ProjectID: 3, PublicProjectID: 1})
	pc, ok := ProjectFromContext(ctx)
	if !ok {
		t.Fatal("expected project context present")
	}
	if pc.ProjectID != 3 || pc.PublicProjectID != 1 {
		t.Errorf("round-trip mismatch: %+v", pc)
	}
}

func TestProjectFromContext_Absent(t *testing.T) {
	if _, ok := ProjectFromContext(context.Background()); ok {
		t.Error("expected no project context in empty context")
	}
}

func TestPublicProjectIDFromEnv(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		t.Setenv("AI_PROJECT_ID", "7")
		if got := publicProjectIDFromEnv(); got != 7 {
			t.Errorf("got %d, want 7", got)
		}
	})
	t.Run("invalid falls back to default", func(t *testing.T) {
		t.Setenv("AI_PROJECT_ID", "not-a-number")
		if got := publicProjectIDFromEnv(); got != defaultPublicProjectID {
			t.Errorf("got %d, want %d", got, defaultPublicProjectID)
		}
	})
	t.Run("zero falls back to default", func(t *testing.T) {
		t.Setenv("AI_PROJECT_ID", "0")
		if got := publicProjectIDFromEnv(); got != defaultPublicProjectID {
			t.Errorf("got %d, want %d", got, defaultPublicProjectID)
		}
	})
	t.Run("unset falls back to default", func(t *testing.T) {
		t.Setenv("AI_PROJECT_ID", "")
		if got := publicProjectIDFromEnv(); got != defaultPublicProjectID {
			t.Errorf("got %d, want %d", got, defaultPublicProjectID)
		}
	})
}

func assertProjectJSONErrorBody(t *testing.T, body []byte) {
	t.Helper()
	var envelope struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("body is not valid JSON: %s", body)
	}
	if envelope.Error.Message == "" {
		t.Error("error.message is empty")
	}
	if envelope.Error.Type == "" {
		t.Error("error.type is empty")
	}
	if envelope.Error.Code == "" {
		t.Error("error.code is empty")
	}
}
