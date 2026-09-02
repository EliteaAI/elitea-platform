package routes_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/routes"
)

type forwarded struct{ path, project, user, method string }

func table(record *[]forwarded, invoke http.HandlerFunc) routes.Table {
	return routes.Table{
		SlotsPath:        "/x/slots/{project_id}",
		InvokePath:       "/x/tools/{project_id}/{toolkit_name}/{tool_name}/invoke",
		InvocationPath:   "/x/invocations/{project_id}/{toolkit_name}/{tool_name}/{invocation_id}",
		Mode:             "default",
		ReadPermission:   "x.read",
		InvokePermission: "x.invoke",
		Auth:             apimw.AuthConfig{Validator: tokens{}, PrincipalValidator: principals{}, SessionSecret: "s"},
		Permissions:      resolver{},
		Forward: func(w http.ResponseWriter, r *http.Request, providerPath, projectID, userID string) {
			*record = append(*record, forwarded{providerPath, projectID, userID, r.Method})
			w.WriteHeader(http.StatusOK)
		},
		Invoke: invoke,
		UserID: func(*http.Request) string { return "7" },
	}
}

func do(h http.Handler, method, path, bearer string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	if bearer != "" {
		r.Header.Set("Authorization", "Bearer "+bearer)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestEveryRouteForwardsToItsProviderPath(t *testing.T) {
	var got []forwarded
	h, err := routes.Build(table(&got, nil))
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ method, path, want string }{
		{http.MethodGet, "/x/slots/1", "/slots"},
		{http.MethodPost, "/x/tools/1/Wikis/generate_wiki/invoke", "/tools/Wikis/generate_wiki/invoke"},
		{http.MethodGet, "/x/invocations/1/Wikis/generate_wiki/inv-1", "/tools/Wikis/generate_wiki/invocations/inv-1"},
		{http.MethodDelete, "/x/invocations/1/Wikis/generate_wiki/inv-1", "/tools/Wikis/generate_wiki/invocations/inv-1"},
	} {
		got = nil
		if w := do(h, c.method, c.path, "all"); w.Code != http.StatusOK {
			t.Fatalf("%s %s: %d %s", c.method, c.path, w.Code, w.Body.String())
		}
		if len(got) != 1 || got[0].path != c.want || got[0].project != "1" || got[0].user != "7" {
			t.Fatalf("%s %s forwarded %+v, want %s for project 1 user 7", c.method, c.path, got, c.want)
		}
	}
}

func TestPollingIsReadingAndCancellingIsInvoking(t *testing.T) {
	var got []forwarded
	h, err := routes.Build(table(&got, nil))
	if err != nil {
		t.Fatal(err)
	}
	// A reader may poll but not cancel; an invoker may cancel.
	if w := do(h, http.MethodGet, "/x/invocations/1/Wikis/t/inv-1", "reader"); w.Code != http.StatusOK {
		t.Fatalf("a reader could not poll: %d", w.Code)
	}
	if w := do(h, http.MethodDelete, "/x/invocations/1/Wikis/t/inv-1", "reader"); w.Code != http.StatusForbidden {
		t.Fatalf("a reader cancelled: %d", w.Code)
	}
	if w := do(h, http.MethodPost, "/x/tools/1/Wikis/t/invoke", "reader"); w.Code != http.StatusForbidden {
		t.Fatalf("a reader invoked: %d", w.Code)
	}
	if w := do(h, http.MethodGet, "/x/slots/1", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("no credential reached the hop: %d", w.Code)
	}
	if len(got) != 1 {
		t.Fatalf("the hop saw %d requests, want the one poll", len(got))
	}
}

func TestAnInvokeOverrideServesThePostBehindTheSameGuard(t *testing.T) {
	var got []forwarded
	override := func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusAccepted) }
	h, err := routes.Build(table(&got, override))
	if err != nil {
		t.Fatal(err)
	}
	if w := do(h, http.MethodPost, "/x/tools/1/Wikis/t/invoke", "all"); w.Code != http.StatusAccepted {
		t.Fatalf("the override did not serve the invoke: %d", w.Code)
	}
	if len(got) != 0 {
		t.Fatal("the override was forwarded as well")
	}
	if w := do(h, http.MethodPost, "/x/tools/1/Wikis/t/invoke", "reader"); w.Code != http.StatusForbidden {
		t.Fatalf("the override bypassed the guard: %d", w.Code)
	}
}

func TestAnIncompleteTableIsRefused(t *testing.T) {
	var got []forwarded
	complete := table(&got, nil)
	cases := map[string]func(*routes.Table){
		"no slots path":          func(x *routes.Table) { x.SlotsPath = "" },
		"no invoke permission":   func(x *routes.Table) { x.InvokePermission = "" },
		"no hop":                 func(x *routes.Table) { x.Forward = nil },
		"no principal validator": func(x *routes.Table) { x.Auth.PrincipalValidator = nil },
		"no permission resolver": func(x *routes.Table) { x.Permissions = nil },
	}
	for name, breakIt := range cases {
		broken := complete
		breakIt(&broken)
		if _, err := routes.Build(broken); !errors.Is(err, routes.ErrIncompleteTable) {
			t.Errorf("%s was accepted: %v", name, err)
		}
	}
}

// The bearer names the caller's permissions: "all" or "reader".
type tokens struct{}

func (tokens) ValidateToken(_ context.Context, token string) (auth.User, error) {
	if token != "all" && token != "reader" {
		return auth.User{}, auth.ErrCredentialRejected
	}
	return auth.User{ID: "7", UserID: "7", Name: token}, nil
}

type principals struct{}

func (principals) ValidatePrincipal(_ context.Context, u auth.User) (auth.User, error) { return u, nil }

type resolver struct{}

func (resolver) ResolvePermissions(_ context.Context, u auth.User, _, _ string) (auth.PermissionResolution, error) {
	if strings.EqualFold(u.Name, "all") {
		return auth.PermissionResolution{UserID: 7, Permissions: []string{"x.read", "x.invoke"}}, nil
	}
	return auth.PermissionResolution{UserID: 7, Permissions: []string{"x.read"}}, nil
}
