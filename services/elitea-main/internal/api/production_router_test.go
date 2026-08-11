package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/shadow"
	agentexecutionapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/agentexecution"
	applicationskillsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/applicationskills"
	v2auth "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/auth"
	configurationapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	indexingapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indexing"
	indextypesapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indextypes"
	notificationsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/notifications"
	projectinfoapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projectinfo"
	v2projects "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projects"
	promptcontextreadsapi "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/promptcontextreads"
	v2social "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/social"
	socialapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/social"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/cutover"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
)

func TestProductionRouterMountsAllCurrentAgentExecutionPaths(t *testing.T) {
	handler := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	})
	router := NewRouter(RouterConfig{CurrentAgentStart: handler})

	for _, test := range []struct {
		method string
		path   string
		want   int
	}{
		{http.MethodPost, "/api/v2/elitea_core/messages/prompt_lib/2/conversation", http.StatusNoContent},
		{http.MethodPost, "/api/v2/elitea_core/regenerate/prompt_lib/2/message", http.StatusNoContent},
		{http.MethodPost, "/api/v2/elitea_core/continue_predict/prompt_lib/2/conversation", http.StatusNoContent},
		{http.MethodGet, "/api/v2/elitea_core/continue_predict/prompt_lib/2/conversation", http.StatusMethodNotAllowed},
	} {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
			if response.Code != test.want {
				t.Fatalf("status=%d want=%d body=%q", response.Code, test.want, response.Body.String())
			}
		})
	}

	uncomposed := NewRouter(RouterConfig{})
	response := httptest.NewRecorder()
	uncomposed.ServeHTTP(
		response,
		httptest.NewRequest(
			http.MethodPost,
			strings.NewReplacer(
				"{projectID}", "2",
				"{conversationID}", "conversation",
			).Replace(agentexecutionapi.CurrentContinuationPath),
			nil,
		),
	)
	if response.Code != http.StatusNotFound {
		t.Fatalf("uncomposed continuation status=%d", response.Code)
	}
}

func TestProductionRouterMountsCurrentAgentCancelOnlyWhenComposed(t *testing.T) {
	handler := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	})
	path := "/api/v2/elitea_core/task/prompt_lib/2/10000000-0000-4000-8000-000000000051"
	for _, test := range []struct {
		name   string
		router http.Handler
		method string
		want   int
	}{
		{name: "delete", router: NewRouter(RouterConfig{CurrentAgentCancel: handler}), method: http.MethodDelete, want: http.StatusNoContent},
		{name: "wrong method", router: NewRouter(RouterConfig{CurrentAgentCancel: handler}), method: http.MethodGet, want: http.StatusMethodNotAllowed},
		{name: "uncomposed", router: NewRouter(RouterConfig{}), method: http.MethodDelete, want: http.StatusNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			test.router.ServeHTTP(response, httptest.NewRequest(test.method, path, nil))
			if response.Code != test.want {
				t.Fatalf("status=%d want=%d body=%q", response.Code, test.want, response.Body.String())
			}
		})
	}
}

type productionChatConfigReader struct{}

func (productionChatConfigReader) GetCurrentChatConfig(
	context.Context,
	int64,
) (promptcontextreadsapi.CurrentChatConfig, error) {
	return promptcontextreadsapi.CurrentChatConfig{
		ChatMaxUploadCount:       "10",
		ChatMaxUploadSizeMB:      "150",
		ChatMaxFileUploadSizeMB:  "150",
		ChatMaxImageUploadCount:  "10",
		ChatMaxImageUploadSizeMB: "3",
	}, nil
}

type productionProjectContextReader struct{}

func (productionProjectContextReader) GetCurrentProjectContext(
	context.Context,
	int64,
) (promptcontextreadsapi.CurrentProjectContext, error) {
	return promptcontextreadsapi.CurrentProjectContext{Content: "", Enabled: true}, nil
}

type productionPromptContextPermissionResolver struct{}

func (productionPromptContextPermissionResolver) ResolvePermissions(
	context.Context,
	auth.User,
	string,
	string,
) (auth.PermissionResolution, error) {
	return auth.PermissionResolution{
		UserID: 11,
		Permissions: []string{
			promptcontextreadsapi.CurrentChatConfigPermission,
			promptcontextreadsapi.CurrentProjectContextPermission,
		},
	}, nil
}

func TestProductionRouterMountsOnlyCurrentPromptContextGETs(t *testing.T) {
	routes, err := promptcontextreadsapi.NewCurrentRoutes(
		productionChatConfigReader{},
		productionProjectContextReader{},
		middleware.AuthConfig{
			PrincipalValidator:        productionProjectPrincipalValidator{},
			ForwardedIdentityVerifier: productionProjectPeerVerifier{},
		},
		productionPromptContextPermissionResolver{},
	)
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(RouterConfig{CurrentPromptContextReads: routes})
	for _, test := range []struct {
		method string
		path   string
		want   int
	}{
		{http.MethodGet, "/api/v2/elitea_core/chat_config/prompt_lib/7", http.StatusOK},
		{http.MethodGet, "/api/v2/elitea_core/project_context/prompt_lib/7/project-context", http.StatusOK},
		{http.MethodPut, "/api/v2/elitea_core/project_context/prompt_lib/7/project-context", http.StatusMethodNotAllowed},
		{http.MethodDelete, "/api/v2/elitea_core/project_context/prompt_lib/7/project-context", http.StatusMethodNotAllowed},
		{http.MethodGet, "/api/v2/elitea_core/chat_config/default/7", http.StatusNotFound},
	} {
		request := httptest.NewRequest(test.method, test.path, nil)
		request.RemoteAddr = "10.0.0.8:43120"
		request.Header.Set("X-Auth-Type", "user")
		request.Header.Set("X-Auth-ID", "11")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != test.want {
			t.Fatalf("%s %s status=%d want=%d body=%q", test.method, test.path, response.Code, test.want, response.Body.String())
		}
	}

	uncomposed := NewRouter(RouterConfig{})
	for _, path := range []string{
		"/api/v2/elitea_core/chat_config/prompt_lib/7",
		"/api/v2/elitea_core/project_context/prompt_lib/7/project-context",
	} {
		response := httptest.NewRecorder()
		uncomposed.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("uncomposed %s status=%d", path, response.Code)
		}
	}
}

func TestProductionAuthRoutesRequireBothReviewedEdges(t *testing.T) {
	handler := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	for name, test := range map[string]struct {
		browser http.Handler
		main    http.Handler
	}{
		"missing browser": {main: handler},
		"missing main":    {browser: handler},
		"both missing":    {},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := NewProductionAuthRoutes(test.browser, test.main); !errors.Is(err, ErrInvalidProductionAuthRoutes) {
				t.Fatalf("error = %v, want %v", err, ErrInvalidProductionAuthRoutes)
			}
		})
	}
}

func TestProductionRouterMountsOnlyReviewedAuthEdges(t *testing.T) {
	browser := chi.NewRouter()
	browser.Get("/login", func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	})
	browser.Post("/auth_form/authorize", func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	})
	main := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	})
	authRoutes, err := NewProductionAuthRoutes(browser, main)
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(RouterConfig{ProductionAuth: authRoutes})

	for _, route := range []struct {
		method string
		path   string
		want   int
	}{
		{http.MethodGet, "/forward-auth/login", http.StatusNoContent},
		{http.MethodPost, "/forward-auth/auth_form/authorize", http.StatusNoContent},
		{http.MethodGet, "/internal/forward-auth/main", http.StatusNoContent},
		{http.MethodGet, "/forward-auth/auth", http.StatusNotFound},
		{http.MethodGet, "/forward-auth/info", http.StatusNotFound},
		{http.MethodPost, "/internal/forward-auth/main", http.StatusMethodNotAllowed},
	} {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(route.method, route.path, nil))
			if recorder.Code != route.want {
				t.Fatalf("status = %d, want %d", recorder.Code, route.want)
			}
		})
	}
}

func TestCompatibilityRouterRetainsReviewedProductionAuthEdges(t *testing.T) {
	browser := chi.NewRouter()
	browser.Get("/login", func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	})
	main := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	})
	agentStart := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("X-Reviewed-Agent-Route", "true")
		writer.WriteHeader(http.StatusAccepted)
	})
	authRoutes, err := NewProductionAuthRoutes(browser, main)
	if err != nil {
		t.Fatal(err)
	}

	// AppsRepo is representative of the current hybrid composition and forces
	// the compatibility router until that API has moved to production routes.
	router := NewRouter(RouterConfig{
		ProductionAuth:    authRoutes,
		CurrentAgentStart: agentStart,
		AppsRepo:          struct{ applications.Repository }{},
	})

	for _, route := range []struct {
		method string
		path   string
		want   int
	}{
		{http.MethodGet, "/forward-auth/login", http.StatusNoContent},
		{http.MethodGet, "/internal/forward-auth/main", http.StatusNoContent},
		{http.MethodPost, "/internal/forward-auth/main", http.StatusMethodNotAllowed},
		{http.MethodPost, "/api/v2/elitea_core/messages/prompt_lib/2/conversation", http.StatusAccepted},
		{http.MethodPost, "/api/v2/elitea_core/regenerate/prompt_lib/2/message", http.StatusAccepted},
		{http.MethodPost, "/api/v2/elitea_core/continue_predict/prompt_lib/2/conversation", http.StatusAccepted},
	} {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(route.method, route.path, nil))
			if recorder.Code != route.want {
				t.Fatalf("status = %d, want %d", recorder.Code, route.want)
			}
			if route.want == http.StatusAccepted && recorder.Header().Get("X-Reviewed-Agent-Route") != "true" {
				t.Fatal("request did not reach the reviewed current-agent route")
			}
		})
	}
}

type productionProjectStore struct{}

func (productionProjectStore) ListCurrentUserProjects(
	context.Context,
	sqlcgen.ListCurrentUserProjectsParams,
) ([]sqlcgen.ListCurrentUserProjectsRow, error) {
	return []sqlcgen.ListCurrentUserProjectsRow{}, nil
}

type productionProjectPrincipalValidator struct{}

func (productionProjectPrincipalValidator) ValidatePrincipal(_ context.Context, user auth.User) (auth.User, error) {
	return user, nil
}

type productionProjectPeerVerifier struct{}

func (productionProjectPeerVerifier) VerifyForwardedIdentityPeer(*http.Request) error { return nil }

type productionProjectPermissionResolver struct{}

func (productionProjectPermissionResolver) ResolvePermissions(
	context.Context,
	auth.User,
	string,
	string,
) (auth.PermissionResolution, error) {
	return auth.PermissionResolution{}, nil
}

func TestProductionRouterMountsOnlyExactCurrentProjectListPath(t *testing.T) {
	projectList, err := v2projects.NewCurrentProjectListRoute(
		productionProjectStore{},
		middleware.AuthConfig{
			PrincipalValidator:        productionProjectPrincipalValidator{},
			ForwardedIdentityVerifier: productionProjectPeerVerifier{},
		},
		productionProjectPermissionResolver{},
	)
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(RouterConfig{CurrentProjectList: projectList})

	for _, test := range []struct {
		method string
		path   string
		want   int
	}{
		{method: http.MethodGet, path: v2projects.CurrentProjectListPath, want: http.StatusUnauthorized},
		{method: http.MethodPost, path: v2projects.CurrentProjectListPath, want: http.StatusMethodNotAllowed},
		{method: http.MethodGet, path: "/projects/project/default/2", want: http.StatusNotFound},
		{method: http.MethodGet, path: "/projects/project/prompt_lib/1", want: http.StatusNotFound},
		{method: http.MethodGet, path: "/projects/project/default/1", want: http.StatusNotFound},
		{method: http.MethodGet, path: "/api/v2/projects/project/default/2", want: http.StatusNotFound},
	} {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(test.method, test.path, nil))
			if recorder.Code != test.want {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, test.want, recorder.Body.String())
			}
		})
	}
}

type productionSocialAuthorsReader struct {
	calls int
}

func (reader *productionSocialAuthorsReader) ListCurrentProjectAuthors(
	context.Context,
	int32,
) ([]socialapp.CurrentAuthor, error) {
	reader.calls++
	return []socialapp.CurrentAuthor{}, nil
}

type productionSocialAuthorsPermissionResolver struct{}

func (productionSocialAuthorsPermissionResolver) ResolvePermissions(
	context.Context,
	auth.User,
	string,
	string,
) (auth.PermissionResolution, error) {
	return auth.PermissionResolution{
		UserID:      41,
		Permissions: []string{v2social.CurrentAuthorsPermission},
	}, nil
}

func TestProductionRouterMountsOnlyExactCurrentSocialAuthorsPaths(t *testing.T) {
	reader := &productionSocialAuthorsReader{}
	authors, err := v2social.NewCurrentAuthorsRoute(
		reader,
		middleware.AuthConfig{
			PrincipalValidator:        productionProjectPrincipalValidator{},
			ForwardedIdentityVerifier: productionProjectPeerVerifier{},
		},
		productionSocialAuthorsPermissionResolver{},
	)
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(RouterConfig{CurrentSocialAuthors: authors})

	for _, target := range []string{
		"/api/v2/social/authors/7",
		"/api/v2/social/authors/default/7?limit=5&sort_by=name",
	} {
		request := httptest.NewRequest(http.MethodGet, target, nil)
		request.RemoteAddr = "10.0.0.8:43120"
		request.Header.Set("X-Auth-Type", "user")
		request.Header.Set("X-Auth-ID", "41")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK || recorder.Body.String() != "[]\n" {
			t.Fatalf("GET %s status=%d body=%q", target, recorder.Code, recorder.Body.String())
		}
	}
	if reader.calls != 2 {
		t.Fatalf("reader calls=%d want=2", reader.calls)
	}

	for _, test := range []struct {
		method string
		path   string
		want   int
	}{
		{method: http.MethodPost, path: "/api/v2/social/authors/7", want: http.StatusMethodNotAllowed},
		{method: http.MethodGet, path: "/api/v2/social/authors/administration/7", want: http.StatusNotFound},
		{method: http.MethodGet, path: "/api/v2/social/authors/7/extra", want: http.StatusNotFound},
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(test.method, test.path, nil))
		if recorder.Code != test.want {
			t.Fatalf("%s %s status=%d want=%d", test.method, test.path, recorder.Code, test.want)
		}
	}

	unmounted := NewRouter(RouterConfig{})
	recorder := httptest.NewRecorder()
	unmounted.ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, "/api/v2/social/authors/7", nil),
	)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("uncomposed status=%d", recorder.Code)
	}
}

type productionProjectInfoReader struct {
	calls     int
	projectID int32
}

func (reader *productionProjectInfoReader) GetCurrentProjectInfo(
	_ context.Context,
	projectID int32,
) (projectinfoapi.CurrentProjectInfo, error) {
	reader.calls++
	reader.projectID = projectID
	return projectinfoapi.CurrentProjectInfo{
		TeammatesCount: 2,
		IconMeta:       []byte(`{"url":"/project-icons/seven.svg"}`),
	}, nil
}

type productionProjectInfoPermissionResolver struct{}

func (productionProjectInfoPermissionResolver) ResolvePermissions(
	_ context.Context,
	user auth.User,
	mode string,
	projectID string,
) (auth.PermissionResolution, error) {
	if user.UserID != "11" || mode != projectinfoapi.CurrentProjectInfoMode ||
		projectID != "7" {
		return auth.PermissionResolution{}, errors.New("unexpected project-info authorization input")
	}
	return auth.PermissionResolution{
		UserID:      11,
		Permissions: []string{projectinfoapi.CurrentProjectInfoPermission},
	}, nil
}

func TestProductionRouterMountsOnlyExactCurrentProjectInfoPathWhenComposed(t *testing.T) {
	reader := &productionProjectInfoReader{}
	projectInfo, err := projectinfoapi.NewCurrentProjectInfoRoute(
		reader,
		middleware.AuthConfig{
			PrincipalValidator:        productionProjectPrincipalValidator{},
			ForwardedIdentityVerifier: productionProjectPeerVerifier{},
		},
		productionProjectInfoPermissionResolver{},
	)
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(RouterConfig{CurrentProjectInfo: projectInfo})

	for _, test := range []struct {
		method        string
		path          string
		authenticated bool
		want          int
	}{
		{
			method:        http.MethodGet,
			path:          "/api/v2/elitea_core/project_info/prompt_lib/007/project-info",
			authenticated: true,
			want:          http.StatusOK,
		},
		{
			method: http.MethodGet,
			path:   "/api/v2/elitea_core/project_info/prompt_lib/7/project-info",
			want:   http.StatusUnauthorized,
		},
		{
			method: http.MethodPut,
			path:   "/api/v2/elitea_core/project_info/prompt_lib/7/project-info",
			want:   http.StatusMethodNotAllowed,
		},
		{
			method: http.MethodGet,
			path:   "/api/v2/elitea_core/project_info/default/7/project-info",
			want:   http.StatusNotFound,
		},
		{
			method: http.MethodGet,
			path:   "/api/v2/elitea_core/project_info/prompt_lib/7/project-info/extra",
			want:   http.StatusNotFound,
		},
	} {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(test.method, test.path, nil)
			if test.authenticated {
				request.Header.Set("X-Auth-Type", "user")
				request.Header.Set("X-Auth-ID", "11")
			}
			router.ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf(
					"status = %d, want %d; body=%s",
					recorder.Code,
					test.want,
					recorder.Body.String(),
				)
			}
			if test.want == http.StatusOK &&
				recorder.Body.String() !=
					"{\"teammates_count\":2,\"icon_meta\":{\"url\":\"/project-icons/seven.svg\"}}\n" {
				t.Fatalf("successful body=%q", recorder.Body.String())
			}
		})
	}
	if reader.calls != 1 || reader.projectID != 7 {
		t.Fatalf("reader calls=%d project=%d", reader.calls, reader.projectID)
	}

	uncomposed := NewRouter(RouterConfig{})
	recorder := httptest.NewRecorder()
	uncomposed.ServeHTTP(
		recorder,
		httptest.NewRequest(
			http.MethodGet,
			"/api/v2/elitea_core/project_info/prompt_lib/7/project-info",
			nil,
		),
	)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("uncomposed project-info status=%d", recorder.Code)
	}
}

type productionIndexTypesReader struct {
	calls     int
	projectID int32
}

func (reader *productionIndexTypesReader) GetCurrentIndexTypes(
	_ context.Context,
	projectID int32,
) (indextypesapi.CurrentIndexTypes, error) {
	reader.calls++
	reader.projectID = projectID
	return indextypesapi.CurrentIndexTypes{
		DocumentTypes: map[string]string{".txt": "text/plain"},
		ImageTypes:    map[string]string{".png": "image/png"},
		CodeTypes:     map[string]string{".go": "text/x-go"},
	}, nil
}

type productionIndexTypesPermissionResolver struct{}

func (productionIndexTypesPermissionResolver) ResolvePermissions(
	_ context.Context,
	user auth.User,
	mode string,
	projectID string,
) (auth.PermissionResolution, error) {
	if user.UserID != "11" || mode != indextypesapi.CurrentIndexTypesMode ||
		projectID != "7" {
		return auth.PermissionResolution{}, errors.New("unexpected index-types authorization input")
	}
	return auth.PermissionResolution{
		UserID:      11,
		Permissions: []string{indextypesapi.CurrentIndexTypesPermission},
	}, nil
}

func TestProductionRouterMountsOnlyExactCurrentIndexTypesPathWhenComposed(t *testing.T) {
	reader := &productionIndexTypesReader{}
	indexTypes, err := indextypesapi.NewCurrentIndexTypesRoute(
		reader,
		middleware.AuthConfig{
			PrincipalValidator:        productionProjectPrincipalValidator{},
			ForwardedIdentityVerifier: productionProjectPeerVerifier{},
		},
		productionIndexTypesPermissionResolver{},
	)
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(RouterConfig{CurrentIndexTypes: indexTypes})

	for _, test := range []struct {
		method        string
		path          string
		authenticated bool
		want          int
	}{
		{
			method:        http.MethodGet,
			path:          "/api/v2/elitea_core/index_types/prompt_lib/007",
			authenticated: true,
			want:          http.StatusOK,
		},
		{
			method: http.MethodGet,
			path:   "/api/v2/elitea_core/index_types/prompt_lib/7",
			want:   http.StatusUnauthorized,
		},
		{
			method: http.MethodPost,
			path:   "/api/v2/elitea_core/index_types/prompt_lib/7",
			want:   http.StatusMethodNotAllowed,
		},
		{
			method: http.MethodGet,
			path:   "/api/v2/elitea_core/index_types/default/7",
			want:   http.StatusNotFound,
		},
		{
			method: http.MethodGet,
			path:   "/api/v2/elitea_core/index_types/prompt_lib/7/extra",
			want:   http.StatusNotFound,
		},
	} {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(test.method, test.path, nil)
			if test.authenticated {
				request.Header.Set("X-Auth-Type", "user")
				request.Header.Set("X-Auth-ID", "11")
			}
			router.ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf(
					"status = %d, want %d; body=%s",
					recorder.Code,
					test.want,
					recorder.Body.String(),
				)
			}
			if test.want == http.StatusOK &&
				recorder.Body.String() !=
					"{\"document_types\":{\".txt\":\"text/plain\"},\"image_types\":{\".png\":\"image/png\"},\"code_types\":{\".go\":\"text/x-go\"}}\n" {
				t.Fatalf("successful body=%q", recorder.Body.String())
			}
		})
	}
	if reader.calls != 1 || reader.projectID != 7 {
		t.Fatalf("reader calls=%d project=%d", reader.calls, reader.projectID)
	}

	uncomposed := NewRouter(RouterConfig{})
	recorder := httptest.NewRecorder()
	uncomposed.ServeHTTP(
		recorder,
		httptest.NewRequest(
			http.MethodGet,
			"/api/v2/elitea_core/index_types/prompt_lib/7",
			nil,
		),
	)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("uncomposed index-types status=%d", recorder.Code)
	}
}

type productionApplicationSkillsReader struct {
	calls        int
	projectID    int32
	appVersionID int32
}

func (reader *productionApplicationSkillsReader) ListCurrentApplicationSkills(
	_ context.Context,
	projectID int32,
	appVersionID int32,
) ([]applicationskillsapi.CurrentApplicationSkill, error) {
	reader.calls++
	reader.projectID = projectID
	reader.appVersionID = appVersionID
	versionID := int32(19)
	return []applicationskillsapi.CurrentApplicationSkill{
		{
			Name:           "deploy",
			Description:    "Deploy safely",
			SkillID:        17,
			VersionID:      &versionID,
			VersionName:    "release",
			VersionMissing: false,
		},
	}, nil
}

type productionApplicationSkillsPermissionResolver struct{}

func (productionApplicationSkillsPermissionResolver) ResolvePermissions(
	_ context.Context,
	user auth.User,
	mode string,
	projectID string,
) (auth.PermissionResolution, error) {
	if user.UserID != "11" ||
		mode != applicationskillsapi.CurrentApplicationSkillsMode ||
		projectID != "7" {
		return auth.PermissionResolution{}, errors.New(
			"unexpected application-skills authorization input",
		)
	}
	return auth.PermissionResolution{
		UserID: 11,
		Permissions: []string{
			applicationskillsapi.CurrentApplicationSkillsPermission,
		},
	}, nil
}

func TestProductionRouterMountsOnlyExactCurrentApplicationSkillsPathWhenComposed(
	t *testing.T,
) {
	reader := &productionApplicationSkillsReader{}
	route, err := applicationskillsapi.NewCurrentApplicationSkillsRoute(
		reader,
		middleware.AuthConfig{
			PrincipalValidator:        productionProjectPrincipalValidator{},
			ForwardedIdentityVerifier: productionProjectPeerVerifier{},
		},
		productionApplicationSkillsPermissionResolver{},
	)
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(RouterConfig{CurrentApplicationSkills: route})

	for _, test := range []struct {
		method        string
		path          string
		authenticated bool
		want          int
		wantBody      string
	}{
		{
			method:        http.MethodGet,
			path:          "/api/v2/elitea_core/application_skills/prompt_lib/007/0031",
			authenticated: true,
			want:          http.StatusOK,
			wantBody:      "{\"skills\":[{\"name\":\"deploy\",\"description\":\"Deploy safely\",\"skill_id\":17,\"version_id\":19,\"version_name\":\"release\",\"version_missing\":false,\"icon_meta\":null}],\"max_skills\":5}\n",
		},
		{
			method: http.MethodGet,
			path:   "/api/v2/elitea_core/application_skills/prompt_lib/7/31",
			want:   http.StatusUnauthorized,
		},
		{
			method: http.MethodPost,
			path:   "/api/v2/elitea_core/application_skills/prompt_lib/7/31",
			want:   http.StatusMethodNotAllowed,
		},
		{
			method:        http.MethodGet,
			path:          "/api/v2/elitea_core/application_skills/prompt_lib/7/not-an-id",
			authenticated: true,
			want:          http.StatusNotFound,
			wantBody:      "{\"message\":\"The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.\"}\n",
		},
		{
			method:        http.MethodGet,
			path:          "/api/v2/elitea_core/application_skills/prompt_lib/7/0",
			authenticated: true,
			want:          http.StatusOK,
			wantBody:      "{\"skills\":[],\"max_skills\":5}\n",
		},
		{
			method:        http.MethodGet,
			path:          "/api/v2/elitea_core/application_skills/prompt_lib/7/9999999999999999999999999999999999999999",
			authenticated: true,
			want:          http.StatusOK,
			wantBody:      "{\"skills\":[],\"max_skills\":5}\n",
		},
		{
			method: http.MethodGet,
			path:   "/api/v2/elitea_core/application_skills/default/7/31",
			want:   http.StatusNotFound,
		},
		{
			method: http.MethodGet,
			path:   "/api/v2/elitea_core/application_skills/prompt_lib/7/31/extra",
			want:   http.StatusNotFound,
		},
	} {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(test.method, test.path, nil)
			if test.authenticated {
				request.Header.Set("X-Auth-Type", "user")
				request.Header.Set("X-Auth-ID", "11")
			}
			router.ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf(
					"status = %d, want %d; body=%s",
					recorder.Code,
					test.want,
					recorder.Body.String(),
				)
			}
			if test.wantBody != "" && recorder.Body.String() != test.wantBody {
				t.Fatalf(
					"body=%q want=%q",
					recorder.Body.String(),
					test.wantBody,
				)
			}
		})
	}
	if reader.calls != 1 || reader.projectID != 7 || reader.appVersionID != 31 {
		t.Fatalf(
			"reader calls=%d project=%d app_version=%d",
			reader.calls,
			reader.projectID,
			reader.appVersionID,
		)
	}

	uncomposed := NewRouter(RouterConfig{})
	recorder := httptest.NewRecorder()
	uncomposed.ServeHTTP(
		recorder,
		httptest.NewRequest(
			http.MethodGet,
			"/api/v2/elitea_core/application_skills/prompt_lib/7/31",
			nil,
		),
	)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("uncomposed application-skills status=%d", recorder.Code)
	}
}

func TestProductionRouterMountsOnlyExactCurrentIndexStartPathWhenComposed(t *testing.T) {
	calls := 0
	indexStart := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		if projectID := chi.URLParam(request, "projectID"); projectID != "7" {
			t.Fatalf("projectID = %q, want 7", projectID)
		}
		writer.WriteHeader(http.StatusNoContent)
	})
	router := NewRouter(RouterConfig{CurrentIndexStart: indexStart})

	for _, test := range []struct {
		method string
		path   string
		want   int
	}{
		{method: http.MethodPost, path: "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/7?await_response=false", want: http.StatusNoContent},
		{method: http.MethodGet, path: "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/7", want: http.StatusMethodNotAllowed},
		{method: http.MethodPost, path: "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/7/extra", want: http.StatusNotFound},
	} {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(test.method, test.path, nil))
			if recorder.Code != test.want {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, test.want, recorder.Body.String())
			}
		})
	}
	if calls != 1 {
		t.Fatalf("index start calls = %d, want 1", calls)
	}
	if indexingapi.CurrentIndexStartPath != "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/{projectID}" {
		t.Fatalf("current index path drifted: %s", indexingapi.CurrentIndexStartPath)
	}
}

func TestProductionRouterMountsOnlyExactCurrentIndexCancelPathWhenComposed(t *testing.T) {
	calls := 0
	indexCancel := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		for parameter, want := range map[string]string{
			"projectID": "7",
			"toolkitID": "9",
			"indexName": "docs",
			"taskID":    "0123456789abcdef0123456789abcdef",
		} {
			if got := chi.URLParam(request, parameter); got != want {
				t.Fatalf("%s = %q, want %q", parameter, got, want)
			}
		}
		writer.WriteHeader(http.StatusNoContent)
	})
	router := NewRouter(RouterConfig{CurrentIndexCancel: indexCancel})

	for _, test := range []struct {
		method string
		path   string
		want   int
	}{
		{
			method: http.MethodDelete,
			path:   "/api/v2/elitea_core/index_cancel/prompt_lib/7/9/docs/0123456789abcdef0123456789abcdef",
			want:   http.StatusNoContent,
		},
		{
			method: http.MethodPost,
			path:   "/api/v2/elitea_core/index_cancel/prompt_lib/7/9/docs/0123456789abcdef0123456789abcdef",
			want:   http.StatusMethodNotAllowed,
		},
		{
			method: http.MethodDelete,
			path:   "/api/v2/elitea_core/index_cancel/prompt_lib/7/9/docs/0123456789abcdef0123456789abcdef/extra",
			want:   http.StatusNotFound,
		},
	} {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(test.method, test.path, nil))
			if recorder.Code != test.want {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, test.want, recorder.Body.String())
			}
		})
	}
	if calls != 1 {
		t.Fatalf("index cancel calls = %d, want 1", calls)
	}
	if indexingapi.CurrentIndexCancelPath != "/api/v2/elitea_core/index_cancel/prompt_lib/{projectID}/{toolkitID}/{indexName}/{taskID}" {
		t.Fatalf("current index cancel path drifted: %s", indexingapi.CurrentIndexCancelPath)
	}
}

func TestProductionRouterMountsCurrentModelAndExternalIndexMetaPaths(t *testing.T) {
	modelCalls := 0
	modelDefaultCalls := 0
	indexMetaCalls := 0
	router := NewRouter(RouterConfig{
		CurrentModelCatalog: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			modelCalls++
			if chi.URLParam(request, "projectID") != "7" {
				t.Fatalf("model project id = %q", chi.URLParam(request, "projectID"))
			}
			writer.WriteHeader(http.StatusNoContent)
		}),
		CurrentModelDefault: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			modelDefaultCalls++
			if chi.URLParam(request, "projectID") != "7" {
				t.Fatalf("model-default project id = %q", chi.URLParam(request, "projectID"))
			}
			writer.WriteHeader(http.StatusNoContent)
		}),
		CurrentIndexMeta: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			indexMetaCalls++
			if chi.URLParam(request, "projectID") != "7" || chi.URLParam(request, "toolkitID") != "9" {
				t.Fatalf("index meta params project=%q toolkit=%q", chi.URLParam(request, "projectID"), chi.URLParam(request, "toolkitID"))
			}
			writer.WriteHeader(http.StatusNoContent)
		}),
	})

	for _, target := range []string{
		"/api/v2/configurations/models/7?section=embedding&include_shared=true",
		"/api/v2/elitea_core/index_meta/prompt_lib/7/9",
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if recorder.Code != http.StatusNoContent {
			t.Fatalf("GET %s status=%d body=%s", target, recorder.Code, recorder.Body.String())
		}
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/v2/configurations/models/7", strings.NewReader(`{"name":"gpt","target_project_id":7}`)))
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("POST model default status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if modelCalls != 1 || modelDefaultCalls != 1 || indexMetaCalls != 1 {
		t.Fatalf("model calls=%d model-default calls=%d index-meta calls=%d", modelCalls, modelDefaultCalls, indexMetaCalls)
	}

	unmounted := NewRouter(RouterConfig{})
	for _, target := range []string{
		"/api/v2/configurations/models/7",
		"/api/v2/elitea_core/index_meta/prompt_lib/7/9",
	} {
		recorder := httptest.NewRecorder()
		unmounted.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("uncomposed GET %s status=%d", target, recorder.Code)
		}
	}
	recorder = httptest.NewRecorder()
	unmounted.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/v2/configurations/models/7", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("uncomposed POST model-default status=%d", recorder.Code)
	}
}

func TestProductionRouterKeepsUncomposedIndexDeleteScheduleAndSearchSourceOnly(t *testing.T) {
	calls := 0
	current := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		calls++
	})
	router := NewRouter(RouterConfig{
		CurrentIndexStart:  current,
		CurrentIndexCancel: current,
		CurrentIndexMeta:   current,
	})

	for _, test := range []struct {
		name   string
		method string
		path   string
	}{
		{
			name:   "delete",
			method: indexingapi.SourceOnlyIndexDeleteMethod,
			path:   "/api/v2/elitea_core/index_meta/prompt_lib/7/9/meta-1",
		},
		{
			name:   "schedule",
			method: indexingapi.SourceOnlyIndexScheduleMethod,
			path:   "/api/v2/elitea_core/index_meta/prompt_lib/7/9/meta-1",
		},
		{
			name:   "schedule delete",
			method: indexingapi.SourceOnlyIndexScheduleDeleteMethod,
			path:   "/api/v2/elitea_core/index_schedule/prompt_lib/7/9/meta-1",
		},
		{
			name:   "search",
			method: indexingapi.SourceOnlyIndexSearchMethod,
			path:   "/api/v2/elitea_core/search_options/prompt_lib/7?entities%5B%5D=toolkit",
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			router.ServeHTTP(
				response,
				httptest.NewRequest(test.method, test.path, nil),
			)
			if response.Code != http.StatusNotFound {
				t.Fatalf(
					"%s %s status=%d want=%d body=%s",
					test.method,
					test.path,
					response.Code,
					http.StatusNotFound,
					response.Body.String(),
				)
			}
		})
	}
	if calls != 0 {
		t.Fatalf("source-only index routes reached mounted handlers %d times", calls)
	}
}

func TestProductionRouterMountsCurrentIndexScheduleCRUDOnlyWhenComposed(
	t *testing.T,
) {
	calls := make(map[string]int)
	handler := func(name string) http.Handler {
		return http.HandlerFunc(
			func(writer http.ResponseWriter, request *http.Request) {
				calls[name]++
				if chi.URLParam(request, "projectID") != "7" ||
					chi.URLParam(request, "toolkitID") != "9" ||
					chi.URLParam(request, "indexMetaID") != "meta-1" {
					t.Fatalf(
						"%s params project=%q toolkit=%q index=%q",
						name,
						chi.URLParam(request, "projectID"),
						chi.URLParam(request, "toolkitID"),
						chi.URLParam(request, "indexMetaID"),
					)
				}
				writer.WriteHeader(http.StatusNoContent)
			},
		)
	}
	router := NewRouter(RouterConfig{
		CurrentIndexScheduleUpdate: handler("update"),
		CurrentIndexScheduleDelete: handler("delete"),
	})
	for _, test := range []struct {
		name   string
		method string
		path   string
	}{
		{
			name:   "update",
			method: http.MethodPatch,
			path:   "/api/v2/elitea_core/index_meta/prompt_lib/7/9/meta-1",
		},
		{
			name:   "delete",
			method: http.MethodDelete,
			path:   "/api/v2/elitea_core/index_schedule/prompt_lib/7/9/meta-1",
		},
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(
			response,
			httptest.NewRequest(test.method, test.path, nil),
		)
		if response.Code != http.StatusNoContent || calls[test.name] != 1 {
			t.Fatalf(
				"%s status=%d calls=%d body=%s",
				test.name,
				response.Code,
				calls[test.name],
				response.Body.String(),
			)
		}
	}

	uncomposed := NewRouter(RouterConfig{})
	for _, test := range []struct {
		method string
		path   string
	}{
		{
			method: http.MethodPatch,
			path:   "/api/v2/elitea_core/index_meta/prompt_lib/7/9/meta-1",
		},
		{
			method: http.MethodDelete,
			path:   "/api/v2/elitea_core/index_schedule/prompt_lib/7/9/meta-1",
		},
	} {
		response := httptest.NewRecorder()
		uncomposed.ServeHTTP(
			response,
			httptest.NewRequest(test.method, test.path, nil),
		)
		if response.Code != http.StatusNotFound {
			t.Fatalf(
				"uncomposed %s %s status=%d",
				test.method,
				test.path,
				response.Code,
			)
		}
	}
}

func TestProductionRouterMountsOnlyCurrentNotificationEventsGETWhenComposed(
	t *testing.T,
) {
	target := strings.Replace(
		notificationsapi.CurrentNotificationEventsPath,
		"{projectID}",
		"7",
		1,
	)
	calls := 0
	events := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		if chi.URLParam(request, "projectID") != "7" {
			t.Fatalf("projectID = %q, want 7", chi.URLParam(request, "projectID"))
		}
		writer.WriteHeader(http.StatusNoContent)
	})
	router := NewRouter(RouterConfig{CurrentNotificationEvents: events})

	for _, test := range []struct {
		method string
		path   string
		want   int
	}{
		{http.MethodGet, target, http.StatusNoContent},
		{http.MethodPost, target, http.StatusMethodNotAllowed},
		{http.MethodGet, "/api/v2/notifications/events/default/7", http.StatusNotFound},
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
		if response.Code != test.want {
			t.Fatalf(
				"%s %s status=%d want=%d body=%s",
				test.method,
				test.path,
				response.Code,
				test.want,
				response.Body.String(),
			)
		}
	}
	if calls != 1 {
		t.Fatalf("notification events handler calls = %d, want 1", calls)
	}

	uncomposed := NewRouter(RouterConfig{})
	response := httptest.NewRecorder()
	uncomposed.ServeHTTP(
		response,
		httptest.NewRequest(http.MethodGet, target, nil),
	)
	if response.Code != http.StatusNotFound {
		t.Fatalf("uncomposed status=%d want=%d", response.Code, http.StatusNotFound)
	}
}

func TestProductionRouterMountsOnlyCurrentNotificationAPIMethodsWhenComposed(t *testing.T) {
	calls := 0
	notifications := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		if chi.URLParam(request, "projectID") != "7" {
			t.Fatalf("projectID = %q, want 7", chi.URLParam(request, "projectID"))
		}
		writer.WriteHeader(http.StatusNoContent)
	})
	router := NewRouter(RouterConfig{CurrentNotifications: notifications})

	tests := []struct {
		method string
		path   string
		want   int
	}{
		{http.MethodGet, "/api/v2/notifications/notifications/prompt_lib/7", http.StatusNoContent},
		{http.MethodPut, "/api/v2/notifications/notifications/prompt_lib/7", http.StatusNoContent},
		{http.MethodDelete, "/api/v2/notifications/notifications/prompt_lib/7", http.StatusNoContent},
		{http.MethodGet, "/api/v2/notifications/notification/prompt_lib/7/15", http.StatusNoContent},
		{http.MethodPut, "/api/v2/notifications/notification/prompt_lib/7/15", http.StatusNoContent},
		{http.MethodDelete, "/api/v2/notifications/notification/prompt_lib/7/15", http.StatusNoContent},
		{http.MethodPost, "/api/v2/notifications/notifications/prompt_lib/7", http.StatusMethodNotAllowed},
		{http.MethodGet, "/api/v2/notifications/notification/default/7/15", http.StatusNotFound},
	}
	for _, test := range tests {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
		if response.Code != test.want {
			t.Fatalf("%s %s status=%d want=%d body=%s", test.method, test.path, response.Code, test.want, response.Body.String())
		}
	}
	if calls != 6 {
		t.Fatalf("notification API handler calls = %d, want 6", calls)
	}

	uncomposed := NewRouter(RouterConfig{})
	response := httptest.NewRecorder()
	uncomposed.ServeHTTP(response, httptest.NewRequest(
		http.MethodGet, "/api/v2/notifications/notifications/prompt_lib/7", nil,
	))
	if response.Code != http.StatusNotFound {
		t.Fatalf("uncomposed status=%d want=%d", response.Code, http.StatusNotFound)
	}
}

func TestProductionRouterMountsCurrentIndexMetaDeleteOnlyWhenComposed(t *testing.T) {
	const target = "/api/v2/elitea_core/index_meta/prompt_lib/7/9/meta-1"
	calls := 0
	router := NewRouter(RouterConfig{
		CurrentIndexMetaDelete: http.HandlerFunc(
			func(writer http.ResponseWriter, request *http.Request) {
				calls++
				if request.Method != http.MethodDelete ||
					chi.URLParam(request, "projectID") != "7" ||
					chi.URLParam(request, "toolkitID") != "9" ||
					chi.URLParam(request, "indexMetaID") != "meta-1" {
					t.Fatalf(
						"method=%s project=%q toolkit=%q index_meta=%q",
						request.Method,
						chi.URLParam(request, "projectID"),
						chi.URLParam(request, "toolkitID"),
						chi.URLParam(request, "indexMetaID"),
					)
				}
				writer.WriteHeader(http.StatusNoContent)
			},
		),
	})
	response := httptest.NewRecorder()
	router.ServeHTTP(
		response,
		httptest.NewRequest(http.MethodDelete, target, nil),
	)
	if response.Code != http.StatusNoContent || calls != 1 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, calls, response.Body.String())
	}

	unmounted := httptest.NewRecorder()
	NewRouter(RouterConfig{}).ServeHTTP(
		unmounted,
		httptest.NewRequest(http.MethodDelete, target, nil),
	)
	if unmounted.Code != http.StatusNotFound {
		t.Fatalf("unmounted status=%d body=%s", unmounted.Code, unmounted.Body.String())
	}
}

func TestProductionRouterMountsOnlyCurrentConfigurationReadMethods(t *testing.T) {
	calls := 0
	reader := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		writer.WriteHeader(http.StatusNoContent)
	})
	router := NewRouter(RouterConfig{CurrentConfigurationRead: reader})
	for _, target := range []string{
		"/api/v2/configurations/configurations/7?include_shared=true",
		"/api/v2/configurations/configuration/7/11",
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if recorder.Code != http.StatusNoContent {
			t.Fatalf("GET %s status=%d body=%s", target, recorder.Code, recorder.Body.String())
		}
	}
	for _, target := range []string{
		"/api/v2/configurations/configurations/7",
		"/api/v2/configurations/configuration/7/11",
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, target, nil))
		if recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("POST %s status=%d body=%s", target, recorder.Code, recorder.Body.String())
		}
	}
	if calls != 2 {
		t.Fatalf("read calls=%d", calls)
	}
}

func TestProductionRouterMountsOnlyCurrentConfigurationTypesMethod(t *testing.T) {
	calls := 0
	types := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		if chi.URLParam(request, "projectID") != "7" {
			t.Fatalf("projectID=%q", chi.URLParam(request, "projectID"))
		}
		writer.WriteHeader(http.StatusNoContent)
	})
	router := NewRouter(RouterConfig{CurrentConfigurationTypes: types})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(
		http.MethodGet,
		"/api/v2/configurations/types/7?section=credentials",
		nil,
	))
	if response.Code != http.StatusNoContent || calls != 1 {
		t.Fatalf("GET status=%d calls=%d body=%s", response.Code, calls, response.Body.String())
	}

	for _, test := range []struct {
		method string
		path   string
		want   int
	}{
		{method: http.MethodPost, path: "/api/v2/configurations/types/7", want: http.StatusMethodNotAllowed},
		{method: http.MethodGet, path: "/api/v2/configurations/types/7/extra", want: http.StatusNotFound},
	} {
		response = httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
		if response.Code != test.want {
			t.Fatalf("%s %s status=%d, want %d", test.method, test.path, response.Code, test.want)
		}
	}

	unmounted := NewRouter(RouterConfig{})
	response = httptest.NewRecorder()
	unmounted.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v2/configurations/types/7", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("uncomposed status=%d", response.Code)
	}
}

func TestProductionRouterMountsOnlyCurrentConfigurationMutationMethods(t *testing.T) {
	calls := make(map[string]int)
	mutation := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls[request.Method+" "+request.URL.Path]++
		writer.WriteHeader(http.StatusNoContent)
	})
	router := NewRouter(RouterConfig{CurrentConfigurationMutation: mutation})
	for _, target := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/api/v2/configurations/configurations/7"},
		{method: http.MethodPut, path: "/api/v2/configurations/configuration/7/11"},
		{method: http.MethodDelete, path: "/api/v2/configurations/configuration/7/11"},
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(target.method, target.path, nil))
		if recorder.Code != http.StatusNoContent {
			t.Fatalf("%s %s status=%d body=%s", target.method, target.path, recorder.Code, recorder.Body.String())
		}
		if calls[target.method+" "+target.path] != 1 {
			t.Fatalf("%s %s calls=%d", target.method, target.path, calls[target.method+" "+target.path])
		}
	}

	for _, target := range []struct {
		method string
		path   string
		want   int
	}{
		{method: http.MethodGet, path: "/api/v2/configurations/configurations/7", want: http.StatusMethodNotAllowed},
		{method: http.MethodPatch, path: "/api/v2/configurations/configuration/7/11", want: http.StatusMethodNotAllowed},
		{method: http.MethodPost, path: "/api/v2/configurations/configuration/7/11", want: http.StatusMethodNotAllowed},
		{method: http.MethodPost, path: "/api/v2/configurations/configurations/7/extra", want: http.StatusNotFound},
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(target.method, target.path, nil))
		if recorder.Code != target.want {
			t.Fatalf("%s %s status=%d, want %d", target.method, target.path, recorder.Code, target.want)
		}
	}
}

func TestProductionRouterComposesConfigurationReadAndMutationOnSameCurrentPaths(t *testing.T) {
	reader := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusOK)
	})
	mutation := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	})
	router := NewRouter(RouterConfig{
		CurrentConfigurationRead:     reader,
		CurrentConfigurationMutation: mutation,
	})
	for _, target := range []struct {
		method string
		path   string
		want   int
	}{
		{method: http.MethodGet, path: "/api/v2/configurations/configurations/7", want: http.StatusOK},
		{method: http.MethodGet, path: "/api/v2/configurations/configuration/7/11", want: http.StatusOK},
		{method: http.MethodPost, path: "/api/v2/configurations/configurations/7", want: http.StatusNoContent},
		{method: http.MethodPut, path: "/api/v2/configurations/configuration/7/11", want: http.StatusNoContent},
		{method: http.MethodDelete, path: "/api/v2/configurations/configuration/7/11", want: http.StatusNoContent},
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(target.method, target.path, nil))
		if recorder.Code != target.want {
			t.Fatalf("%s %s status=%d, want %d", target.method, target.path, recorder.Code, target.want)
		}
	}
}

func TestProductionRouterMountsCurrentAvailableAliasesAsGetOnly(t *testing.T) {
	calls := 0
	available := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		writer.WriteHeader(http.StatusNoContent)
	})
	router := NewRouter(RouterConfig{CurrentConfigurationAvailable: available})
	for _, target := range []string{
		configurationapi.CurrentAvailablePath,
		configurationapi.CurrentAvailableSlashPath,
		"/api/v2/configurations/available/7?section=credentials",
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if recorder.Code != http.StatusNoContent {
			t.Fatalf("GET %s status=%d body=%s", target, recorder.Code, recorder.Body.String())
		}
	}
	if calls != 3 {
		t.Fatalf("available calls=%d", calls)
	}

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, configurationapi.CurrentAvailableSlashPath, nil))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST available status=%d", recorder.Code)
	}
}

func TestProductionRouterMountsCurrentLLMFacadeWithoutStrippingContractPath(t *testing.T) {
	calls := 0
	facade := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		if request.URL.Path != "/llm/v1/embeddings" || request.Method != http.MethodPost {
			t.Fatalf("facade request = %s %s", request.Method, request.URL.Path)
		}
		writer.WriteHeader(http.StatusNoContent)
	})
	router := NewRouter(RouterConfig{CurrentLLMFacade: facade})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/llm/v1/embeddings", strings.NewReader(`{"model":"embed"}`)))
	if recorder.Code != http.StatusNoContent || calls != 1 {
		t.Fatalf("status=%d calls=%d body=%s", recorder.Code, calls, recorder.Body.String())
	}

	unmounted := NewRouter(RouterConfig{})
	recorder = httptest.NewRecorder()
	unmounted.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/llm/v1/embeddings", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("uncomposed facade status=%d", recorder.Code)
	}
}

type productionRoutePolicy struct {
	access string
}

func TestProductionRouterMatchesReviewedRoutePolicy(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "false")
	want := map[string]productionRoutePolicy{
		"GET /healthz":  {access: "public health"},
		"GET /readyz":   {access: "public health"},
		"GET /startupz": {access: "public health"},

		// Artifacts (S11): all 16 routes are authenticated and RBAC-gated
		// per configuration.artifacts.artifacts.{view,create,edit,delete} —
		// see mountArtifactRoutes in router.go.
		"GET /api/v2/artifacts/buckets/{projectID}":                              {access: "authenticated + view"},
		"POST /api/v2/artifacts/buckets/{projectID}":                             {access: "authenticated + create"},
		"GET /api/v2/artifacts/buckets/{projectID}/{bucket}":                     {access: "authenticated + view"},
		"PATCH /api/v2/artifacts/buckets/{projectID}/{bucket}":                   {access: "authenticated + edit"},
		"DELETE /api/v2/artifacts/buckets/{projectID}/{bucket}":                  {access: "authenticated + delete"},
		"GET /api/v2/artifacts/objects/{projectID}/{bucket}":                     {access: "authenticated + view"},
		"POST /api/v2/artifacts/objects/{projectID}/{bucket}":                    {access: "authenticated + create"},
		"POST /api/v2/artifacts/objects/{projectID}/{bucket}:batchDelete":        {access: "authenticated + delete"},
		"GET /api/v2/artifacts/objects/{projectID}/{bucket}/*":                   {access: "authenticated + view"},
		"HEAD /api/v2/artifacts/objects/{projectID}/{bucket}/*":                  {access: "authenticated + view"},
		"DELETE /api/v2/artifacts/objects/{projectID}/{bucket}/*":                {access: "authenticated + delete"},
		"POST /api/v2/artifacts/grants/{projectID}/{bucket}":                     {access: "authenticated + create"},
		"POST /api/v2/artifacts/grants/{projectID}/{grantID}:commit":             {access: "authenticated + create"},
		"POST /api/v2/artifacts/grants/{projectID}/{grantID}/parts/{partNumber}": {access: "authenticated + create"},
		"POST /api/v2/artifacts/grants/{projectID}/{grantID}:completeMultipart":  {access: "authenticated + create"},
		"POST /api/v2/artifacts/grants/{projectID}/{grantID}:abortMultipart":     {access: "authenticated + create"},
	}

	router := newCompleteProductionRouter("session-secret")
	got := make(map[string]struct{})
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if method != "*" {
			got[method+" "+route] = struct{}{}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	var missing, unexpected []string
	for route, policy := range want {
		if policy.access == "" {
			t.Fatalf("route %q has no access policy", route)
		}
		if _, ok := got[route]; !ok {
			missing = append(missing, route)
		}
	}
	for route := range got {
		if _, ok := want[route]; !ok {
			unexpected = append(unexpected, route)
		}
	}
	if len(missing) != 0 || len(unexpected) != 0 {
		sort.Strings(missing)
		sort.Strings(unexpected)
		t.Fatalf("production route policy mismatch\nmissing: %v\nunexpected: %v", missing, unexpected)
	}
}

func TestProductionRouterPreservesRawSocketPeer(t *testing.T) {
	router := NewRouter(RouterConfig{})
	router.Get("/__test/raw-peer", func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(request.RemoteAddr))
	})

	request := httptest.NewRequest(http.MethodGet, "/__test/raw-peer", nil)
	request.RemoteAddr = "10.20.30.40:43120"
	request.Header.Set("X-Forwarded-For", "198.51.100.25")
	request.Header.Set("X-Real-IP", "203.0.113.17")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if got, want := recorder.Body.String(), request.RemoteAddr; got != want {
		t.Fatalf("RemoteAddr = %q, want raw socket peer %q", got, want)
	}
}

func TestProductionRouterLeavesUnreviewedPrototypeSurfacesUnmounted(t *testing.T) {
	// Even explicit development identity cannot make a source-only prototype
	// route appear in the production allowlist.
	t.Setenv("AUTH_DEV_MODE", "true")
	router := newCompleteProductionRouter("")

	for _, target := range []string{
		"/socket.io/",
		"/auth",
		"/forward-auth/auth",
		"/forward-auth/info",
		"/forward-auth/logout",
		"/forward-auth/auth_form/logout",
		"/forward-auth/auth_oidc/logout",
		"/forward-auth/auth_oidc/logout_callback",
		"/admin/app/",
		"/app/application_icon/icon.svg",
		"/forward-auth/login",
		"/forward-auth/auth_form/login",
		"/forward-auth/auth_form/authorize",
		"/forward-auth/auth_oidc/login",
		"/forward-auth/auth_oidc/callback",
		"/forward-auth/auth_oidc/login_callback",
		"/api/v2/projects/7",
		"/api/v2/admin/auth_users/",
		"/api/v2/secrets/7",
		"/api/v2/elitea_core/mcp_oauth_proxy/7",
		"/api/v2/artifacts/7",
		"/api/v2/events/",
		"/api/v2/webhooks/7",
		"/api/v2/configurations/available/",
		"/api/v2/configurations/configurations/7",
		"/api/v2/configurations/configuration/7/11",
		"/api/v2/api/v2/configurations/configurations/7",
		"/api/v2/configurations/validation/7/revision-1",
		"/api/v2/executions/7/execution-1/events",
		"/internal/shadow/config",
		"/internal/cutover/",
		"/api/v2/auth/permissions/prompt_lib/7",
		"/api/v2/auth/token/",
		"/api/v2/auth/token/00000000-0000-0000-0000-000000000001",
	} {
		t.Run(target, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
			if recorder.Code != http.StatusNotFound {
				t.Fatalf("GET %s status = %d, want %d", target, recorder.Code, http.StatusNotFound)
			}
		})
	}
}

func TestProductionAuthCandidatesRemainUnmountedForEveryCredentialShape(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "false")
	router := newCompleteProductionRouter("0123456789abcdef0123456789abcdef")
	routes := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/v2/auth/permissions/prompt_lib/7"},
		{method: http.MethodGet, path: "/api/v2/auth/token/"},
		{method: http.MethodGet, path: "/api/v2/auth/token/00000000-0000-0000-0000-000000000001"},
		{method: http.MethodPost, path: "/api/v2/auth/token/"},
		{method: http.MethodDelete, path: "/api/v2/auth/token/00000000-0000-0000-0000-000000000001"},
	}

	for _, route := range routes {
		for _, credential := range []string{"missing", "invalid", "forwarded", "session"} {
			t.Run(route.method+" "+route.path+" "+credential, func(t *testing.T) {
				request := httptest.NewRequest(route.method, route.path, nil)
				switch credential {
				case "invalid":
					request.Header.Set("Authorization", "Bearer invalid")
				case "forwarded":
					request.Header.Set("X-Auth-Type", "user")
					request.Header.Set("X-Auth-Id", "1")
				case "session":
					request.AddCookie(&http.Cookie{Name: "elitea_session", Value: "forged.session"})
				}
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, request)
				if recorder.Code != http.StatusNotFound {
					t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
				}
			})
		}
	}
}

func TestProductionBrowserAuthSurfaceRemainsUnmountedForEffectiveMethods(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "false")
	router := newCompleteProductionRouter("0123456789abcdef0123456789abcdef")
	routes := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/forward-auth/auth"},
		{method: http.MethodHead, path: "/forward-auth/auth"},
		{method: http.MethodOptions, path: "/forward-auth/auth"},
		{method: http.MethodGet, path: "/forward-auth/login"},
		{method: http.MethodHead, path: "/forward-auth/login"},
		{method: http.MethodOptions, path: "/forward-auth/login"},
		{method: http.MethodGet, path: "/forward-auth/auth_form/login"},
		{method: http.MethodHead, path: "/forward-auth/auth_form/login"},
		{method: http.MethodOptions, path: "/forward-auth/auth_form/login"},
		{method: http.MethodPost, path: "/forward-auth/auth_form/authorize"},
		{method: http.MethodOptions, path: "/forward-auth/auth_form/authorize"},
		{method: http.MethodGet, path: "/forward-auth/logout"},
		{method: http.MethodHead, path: "/forward-auth/logout"},
		{method: http.MethodOptions, path: "/forward-auth/logout"},
		{method: http.MethodGet, path: "/forward-auth/auth_form/logout"},
		{method: http.MethodHead, path: "/forward-auth/auth_form/logout"},
		{method: http.MethodOptions, path: "/forward-auth/auth_form/logout"},
		{method: http.MethodGet, path: "/forward-auth/auth_oidc/login"},
		{method: http.MethodHead, path: "/forward-auth/auth_oidc/login"},
		{method: http.MethodOptions, path: "/forward-auth/auth_oidc/login"},
		{method: http.MethodGet, path: "/forward-auth/auth_oidc/login_callback"},
		{method: http.MethodHead, path: "/forward-auth/auth_oidc/login_callback"},
		{method: http.MethodPost, path: "/forward-auth/auth_oidc/login_callback"},
		{method: http.MethodOptions, path: "/forward-auth/auth_oidc/login_callback"},
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(route.method, route.path, nil)
			router.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
			}
		})
	}
}

func newCompleteProductionRouter(sessionSecret string) chi.Router {
	runtimeHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		panic(fmt.Errorf("route coverage test must not execute runtime handler"))
	})
	return NewRouter(RouterConfig{
		SessionHandler: v2auth.NewSessionHandler(nil, sessionSecret),
		OIDCHandler:    &v2auth.OIDCHandler{},
		SessionSecret:  sessionSecret,
		Shadow:         shadow.NewComparator(shadow.Config{Timeout: time.Second}),
		ShadowMetrics:  shadow.NewMetrics(10),
		CutoverTracker: cutover.NewTracker(nil),
		CutoverRouter: cutover.NewRouter(cutover.RouterConfig{
			Tracker:   cutover.NewTracker(nil),
			LegacyURL: "http://127.0.0.1:1",
		}),
		InternalAdminToken: strings.Repeat("i", middleware.MinimumInternalAdminTokenBytes),
		RuntimeRoutes: RuntimeRoutes{
			Validation:      runtimeHandler,
			ExecutionEvents: runtimeHandler,
		},
	})
}
