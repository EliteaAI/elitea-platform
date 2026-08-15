package llmproxy

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
)

// The caller's personal project and the team project are deliberately
// different numbers. The edge resolves the caller's personal project by itself,
// so a test that names the personal project passes whether or not the selector
// is honoured (the personal-project selection trap).
const (
	edgePersonalProject = 7
	edgeTeamProject     = 4321
)

// stubPersonalResolver returns a fixed personal project for any user.
type stubPersonalResolver struct{ id int }

func (s stubPersonalResolver) PersonalProjectID(context.Context, string) (int, error) {
	return s.id, nil
}

// stubMemberQuerier answers the membership query without a database.
type stubMemberQuerier struct{ allow map[int32]bool }

func (s stubMemberQuerier) IsCurrentUserProjectMember(
	_ context.Context,
	params sqlcgen.IsCurrentUserProjectMemberParams,
) (bool, error) {
	return s.allow[params.ProjectID], nil
}

// edgeStack builds the real /llm chain: the project middleware in front of the
// streaming proxy, pointed at a backend that records what the gateway received.
func edgeStack(t *testing.T, allow map[int32]bool, gotHeaders *http.Header) http.Handler {
	t.Helper()

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*gotHeaders = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	t.Cleanup(backend.Close)

	mw := middleware.Project(middleware.ProjectConfig{
		Resolver:        stubPersonalResolver{id: edgePersonalProject},
		PublicProjectID: 1,
		Membership:      middleware.NewProjectMembershipWith(stubMemberQuerier{allow: allow}),
	})
	return mw(proxyTo(t, backend.URL, "sekret"))
}

// edgeRequest builds an authenticated /llm request carrying a selector.
func edgeRequest(header, value string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", strings.NewReader(`{"model":"gpt-4o-mini"}`))
	if header != "" {
		req.Header.Set(header, value)
	}
	user := auth.User{ID: "42", UserID: "42", TokenID: "900", Name: "Regular User", AuthType: "token"}
	return req.WithContext(auth.ContextWithUser(req.Context(), user))
}

// TestEdge_NamedProjectReachesTheGatewayIdentity is the end-to-end form of the
// first discriminating test. The gateway bills strictly on the signed
// X-Elitea-Project-Id, so this asserts the money lands on the named project.
func TestEdge_NamedProjectReachesTheGatewayIdentity(t *testing.T) {
	var gotHeaders http.Header
	stack := edgeStack(t, map[int32]bool{edgeTeamProject: true}, &gotHeaders)

	rec := httptest.NewRecorder()
	stack.ServeHTTP(rec, edgeRequest(middleware.HeaderProjectSelector, "4321"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", rec.Code, rec.Body.String())
	}
	if got := gotHeaders.Get(HeaderProjectID); got != "4321" {
		t.Errorf("gateway billed project %q, want 4321", got)
	}
	if got := gotHeaders.Get(HeaderProjectID); got == "7" {
		t.Errorf("gateway billed the caller's personal project 7; the header named 4321")
	}
	// The identity must be signed over the admitted project, or the gateway
	// rejects it and the assertion above would prove nothing.
	if !verifyIdentitySignature(gotHeaders, []byte("sekret")) {
		t.Errorf("forwarded identity signature did not verify")
	}
}

// TestEdge_NonMemberNeverReachesTheGateway is the end-to-end form of the second
// discriminating test. A refused selector must produce no upstream call at all,
// and above all no upstream call billed to the personal project.
func TestEdge_NonMemberNeverReachesTheGateway(t *testing.T) {
	var gotHeaders http.Header
	stack := edgeStack(t, map[int32]bool{}, &gotHeaders) // member of nothing

	rec := httptest.NewRecorder()
	stack.ServeHTTP(rec, edgeRequest(middleware.HeaderProjectSelector, "4321"))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body = %s", rec.Code, rec.Body.String())
	}
	if gotHeaders != nil {
		t.Fatalf("the gateway was called for a refused selector, with project %q",
			gotHeaders.Get(HeaderProjectID))
	}
}

// TestEdge_AbsentSelectorBillsThePersonalProject holds the compatibility line
// end to end.
func TestEdge_AbsentSelectorBillsThePersonalProject(t *testing.T) {
	var gotHeaders http.Header
	stack := edgeStack(t, map[int32]bool{edgeTeamProject: true}, &gotHeaders)

	rec := httptest.NewRecorder()
	stack.ServeHTTP(rec, edgeRequest("", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := gotHeaders.Get(HeaderProjectID); got != "7" {
		t.Errorf("gateway billed project %q, want the personal project 7", got)
	}
}

// TestEdge_SelectorHeadersAreNotForwarded proves the edge consumes the
// selector. An Elitea project id must not travel onward under a name a real
// provider reads.
func TestEdge_SelectorHeadersAreNotForwarded(t *testing.T) {
	var gotHeaders http.Header
	stack := edgeStack(t, map[int32]bool{edgeTeamProject: true}, &gotHeaders)

	req := edgeRequest(middleware.HeaderProjectSelector, "4321")
	req.Header.Set(middleware.HeaderProjectSelectorOpenAIProject, "4321")
	req.Header.Set(middleware.HeaderProjectSelectorOpenAIOrg, "4321")

	rec := httptest.NewRecorder()
	stack.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	for _, name := range middleware.ProjectSelectorHeaders() {
		if got := gotHeaders.Get(name); got != "" {
			t.Errorf("selector header %s reached the gateway with %q", name, got)
		}
	}
	if got := gotHeaders.Get(HeaderProjectID); got != "4321" {
		t.Errorf("gateway billed project %q, want 4321", got)
	}
}
