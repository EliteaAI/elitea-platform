package middleware

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
)

// The caller's personal project and the team project are deliberately
// different numbers. The /llm path resolves the caller's personal project by
// itself, so a test that names the personal project passes whether or not the
// selector is honoured. Every assertion below names teamProject.
const (
	personalProject = 7
	teamProject     = 4321
)

// fakeMemberQuerier answers the membership query without a database, and
// records what it was asked.
type fakeMemberQuerier struct {
	allow map[int32]bool
	err   error
	calls []sqlcgen.IsCurrentUserProjectMemberParams
}

func (f *fakeMemberQuerier) IsCurrentUserProjectMember(
	_ context.Context,
	params sqlcgen.IsCurrentUserProjectMemberParams,
) (bool, error) {
	f.calls = append(f.calls, params)
	if f.err != nil {
		return false, f.err
	}
	return f.allow[params.ProjectID], nil
}

// selectorRequest builds an authenticated /llm request. A blank header name
// sends no selector at all.
func selectorRequest(header, value string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil)
	if header != "" {
		req.Header.Set(header, value)
	}
	user := auth.User{ID: "42", UserID: "42", TokenID: "900", Name: "Regular User", AuthType: "token"}
	return req.WithContext(auth.ContextWithUser(req.Context(), user))
}

// runSelector drives the middleware and reports what the next handler saw.
func runSelector(
	membership ProjectMembershipChecker,
	req *http.Request,
) (*httptest.ResponseRecorder, ProjectContext, bool) {
	var seen ProjectContext
	var invoked bool
	mw := Project(ProjectConfig{
		Resolver:        &fakeResolver{id: personalProject},
		PublicProjectID: 1,
		Membership:      membership,
	})
	rec := httptest.NewRecorder()
	mw(captureHandler(&seen, &invoked)).ServeHTTP(rec, req)
	return rec, seen, invoked
}

// TestProjectSelector_MemberProjectIsBilled is the first discriminating test:
// the admitted project must be the one the header names, and not the caller's
// personal project.
func TestProjectSelector_MemberProjectIsBilled(t *testing.T) {
	queries := &fakeMemberQuerier{allow: map[int32]bool{teamProject: true}}

	rec, seen, invoked := runSelector(
		NewProjectMembershipWith(queries),
		selectorRequest(HeaderProjectSelector, "4321"),
	)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", rec.Code, rec.Body.String())
	}
	if !invoked {
		t.Fatal("next handler was not invoked")
	}
	if seen.ProjectID != teamProject {
		t.Errorf("billed project = %d, want %d", seen.ProjectID, teamProject)
	}
	if seen.ProjectID == personalProject {
		t.Errorf("billed the caller's personal project %d; the header named %d", personalProject, teamProject)
	}

	// The admission must rest on a membership answer about that exact pair.
	if len(queries.calls) != 1 {
		t.Fatalf("membership queries = %d, want 1", len(queries.calls))
	}
	if got := queries.calls[0]; got.ProjectID != teamProject || got.UserID != 42 {
		t.Errorf("membership asked about %+v, want project %d and user 42", got, teamProject)
	}
}

// TestProjectSelector_NonMemberIsRefused is the second discriminating test: a
// selector the caller may not use is refused. It must not be redirected to the
// personal project, because that silently moves team spend onto a personal
// budget.
func TestProjectSelector_NonMemberIsRefused(t *testing.T) {
	queries := &fakeMemberQuerier{allow: map[int32]bool{}} // member of nothing

	rec, seen, invoked := runSelector(
		NewProjectMembershipWith(queries),
		selectorRequest(HeaderProjectSelector, "4321"),
	)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body = %s", rec.Code, rec.Body.String())
	}
	if invoked {
		t.Error("next handler ran; a refused selector must not reach the proxy")
	}
	if seen.ProjectID == personalProject {
		t.Errorf("silently fell back to the personal project %d", personalProject)
	}
	if seen.ProjectID == teamProject {
		t.Errorf("honoured project %d for a non-member", teamProject)
	}
	if seen != (ProjectContext{}) {
		t.Errorf("project context = %+v, want none", seen)
	}
	assertProjectJSONErrorBody(t, rec.Body.Bytes())

	if len(queries.calls) != 1 {
		t.Fatalf("membership queries = %d, want 1", len(queries.calls))
	}
	if got := queries.calls[0]; got.ProjectID != teamProject || got.UserID != 42 {
		t.Errorf("membership asked about %+v, want project %d and user 42", got, teamProject)
	}
}

// TestProjectSelector_AbsentKeepsPersonalProject holds the compatibility line:
// a caller that sends no selector sees exactly the behaviour it saw before.
func TestProjectSelector_AbsentKeepsPersonalProject(t *testing.T) {
	queries := &fakeMemberQuerier{allow: map[int32]bool{teamProject: true}}

	rec, seen, invoked := runSelector(NewProjectMembershipWith(queries), selectorRequest("", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !invoked {
		t.Fatal("next handler was not invoked")
	}
	if seen.ProjectID != personalProject {
		t.Errorf("billed project = %d, want the personal project %d", seen.ProjectID, personalProject)
	}
	if len(queries.calls) != 0 {
		t.Errorf("membership was queried %d times without a selector", len(queries.calls))
	}
}

// TestProjectSelector_OwnProjectSkipsMembership shows the caller may name the
// project it already resolves to. That needs no membership query.
func TestProjectSelector_OwnProjectSkipsMembership(t *testing.T) {
	queries := &fakeMemberQuerier{allow: map[int32]bool{}}

	rec, seen, _ := runSelector(
		NewProjectMembershipWith(queries),
		selectorRequest(HeaderProjectSelector, "7"),
	)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if seen.ProjectID != personalProject {
		t.Errorf("billed project = %d, want %d", seen.ProjectID, personalProject)
	}
	if len(queries.calls) != 0 {
		t.Errorf("membership was queried %d times for the caller's own project", len(queries.calls))
	}
}

// TestProjectSelector_AcceptedHeaderNames covers each accepted name. The UI
// advertises OpenAI-Project, and the legacy runtime accepted X-Project-Id and
// OpenAI-Organization.
func TestProjectSelector_AcceptedHeaderNames(t *testing.T) {
	for _, header := range []string{
		HeaderProjectSelector,
		HeaderProjectSelectorOpenAIProject,
		HeaderProjectSelectorOpenAIOrg,
	} {
		t.Run(header, func(t *testing.T) {
			queries := &fakeMemberQuerier{allow: map[int32]bool{teamProject: true}}

			rec, seen, _ := runSelector(NewProjectMembershipWith(queries), selectorRequest(header, "4321"))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body = %s", rec.Code, rec.Body.String())
			}
			if seen.ProjectID != teamProject {
				t.Errorf("%s: billed project = %d, want %d", header, seen.ProjectID, teamProject)
			}
		})
	}
}

// TestProjectSelector_Precedence pins the documented order. X-Project-Id wins
// over OpenAI-Project, which wins over OpenAI-Organization.
func TestProjectSelector_Precedence(t *testing.T) {
	queries := &fakeMemberQuerier{allow: map[int32]bool{teamProject: true, 999: true}}

	req := selectorRequest(HeaderProjectSelector, "4321")
	req.Header.Set(HeaderProjectSelectorOpenAIProject, "999")
	req.Header.Set(HeaderProjectSelectorOpenAIOrg, "999")

	_, seen, _ := runSelector(NewProjectMembershipWith(queries), req)

	if seen.ProjectID != teamProject {
		t.Errorf("billed project = %d, want %d from %s", seen.ProjectID, teamProject, HeaderProjectSelector)
	}
}

// TestProjectSelector_MalformedIsRefused proves a selector that names no
// project is reported, not discarded.
func TestProjectSelector_MalformedIsRefused(t *testing.T) {
	for _, value := range []string{"org-abc123", "0", "-3", "12.5", "9999999999999"} {
		t.Run(value, func(t *testing.T) {
			queries := &fakeMemberQuerier{allow: map[int32]bool{teamProject: true}}

			rec, seen, invoked := runSelector(
				NewProjectMembershipWith(queries),
				selectorRequest(HeaderProjectSelector, value),
			)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", rec.Code)
			}
			if invoked {
				t.Error("next handler ran for a malformed selector")
			}
			if seen.ProjectID == personalProject {
				t.Errorf("silently fell back to the personal project %d", personalProject)
			}
			assertProjectJSONErrorBody(t, rec.Body.Bytes())
		})
	}
}

// TestProjectSelector_BlankValueIsAbsent treats an empty header as no header.
func TestProjectSelector_BlankValueIsAbsent(t *testing.T) {
	queries := &fakeMemberQuerier{allow: map[int32]bool{}}

	rec, seen, _ := runSelector(NewProjectMembershipWith(queries), selectorRequest(HeaderProjectSelector, "   "))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if seen.ProjectID != personalProject {
		t.Errorf("billed project = %d, want %d", seen.ProjectID, personalProject)
	}
}

// TestProjectSelector_NilCheckerFailsClosed proves an unconfigured checker
// refuses the selector instead of billing the personal project.
func TestProjectSelector_NilCheckerFailsClosed(t *testing.T) {
	rec, seen, invoked := runSelector(nil, selectorRequest(HeaderProjectSelector, "4321"))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if invoked {
		t.Error("next handler ran with no membership checker configured")
	}
	if seen.ProjectID == personalProject {
		t.Errorf("silently fell back to the personal project %d", personalProject)
	}
	assertProjectJSONErrorBody(t, rec.Body.Bytes())
}

// TestProjectSelector_QueryErrorFailsClosed proves a database failure refuses
// the request rather than billing the personal project.
func TestProjectSelector_QueryErrorFailsClosed(t *testing.T) {
	queries := &fakeMemberQuerier{err: errors.New("connection refused")}

	rec, seen, invoked := runSelector(
		NewProjectMembershipWith(queries),
		selectorRequest(HeaderProjectSelector, "4321"),
	)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if invoked {
		t.Error("next handler ran after a membership query failure")
	}
	if seen.ProjectID == personalProject {
		t.Errorf("silently fell back to the personal project %d", personalProject)
	}
}

// TestProjectSelector_TokenScopedCallerCannotMoveSpend proves a project-scoped
// system token cannot redirect spend to another project. Its user is not a
// member there, so the request is refused.
func TestProjectSelector_TokenScopedCallerCannotMoveSpend(t *testing.T) {
	queries := &fakeMemberQuerier{allow: map[int32]bool{}}

	req := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil)
	req.Header.Set(HeaderProjectSelector, "4321")
	user := auth.User{ID: "42", UserID: "42", TokenID: "900", Name: ":system:project:7:", AuthType: "token"}
	req = req.WithContext(auth.ContextWithUser(req.Context(), user))

	rec, seen, invoked := runSelector(NewProjectMembershipWith(queries), req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if invoked {
		t.Error("next handler ran for a token-scoped caller naming another project")
	}
	if seen.ProjectID == teamProject {
		t.Errorf("token scoped to project 7 billed project %d", teamProject)
	}
}

// TestProjectSelector_UnresolvedOwnerIsRefused proves the check runs against
// the owning user and never against a token id. A token principal whose owner
// was not resolved cannot be checked, so it cannot name a project.
func TestProjectSelector_UnresolvedOwnerIsRefused(t *testing.T) {
	queries := &fakeMemberQuerier{allow: map[int32]bool{teamProject: true}}

	req := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil)
	req.Header.Set(HeaderProjectSelector, "4321")
	// TokenID set, UserID empty: the owner was never resolved.
	user := auth.User{ID: "900", TokenID: "900", Name: "Regular User", AuthType: "token"}
	req = req.WithContext(auth.ContextWithUser(req.Context(), user))

	rec, seen, invoked := runSelector(NewProjectMembershipWith(queries), req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if invoked {
		t.Error("next handler ran for a principal with no owning user")
	}
	if seen.ProjectID == personalProject {
		t.Errorf("silently fell back to the personal project %d", personalProject)
	}
	if len(queries.calls) != 0 {
		t.Errorf("membership was queried %d times; the token id must never be used as a user id", len(queries.calls))
	}
}

// TestIsProjectMember_OutOfRangeUserRefuses proves an id that does not fit the
// int4 column is refused, and that the refusal is not reported as an outage.
func TestIsProjectMember_OutOfRangeUserRefuses(t *testing.T) {
	queries := &fakeMemberQuerier{allow: map[int32]bool{teamProject: true}}
	checker := NewProjectMembershipWith(queries)

	for _, userID := range []int64{0, -1, math.MaxInt32 + 1} {
		member, err := checker.IsProjectMember(context.Background(), userID, teamProject)
		if err != nil {
			t.Fatalf("user %d: err = %v, want nil", userID, err)
		}
		if member {
			t.Errorf("user %d was admitted as a member", userID)
		}
	}
	if len(queries.calls) != 0 {
		t.Errorf("the query ran %d times for an out-of-range user id", len(queries.calls))
	}
}

// TestNewProjectMembership_NilPoolIsNilInterface guards the typed-nil trap. A
// nil *pgxpool.Pool boxed into the interface would compare non-nil and panic on
// the first query.
func TestNewProjectMembership_NilPoolIsNilInterface(t *testing.T) {
	if checker := NewProjectMembership(nil); checker != nil {
		t.Errorf("NewProjectMembership(nil) = %#v, want a nil interface", checker)
	}
	if checker := NewProjectMembershipWith(nil); checker != nil {
		t.Errorf("NewProjectMembershipWith(nil) = %#v, want a nil interface", checker)
	}
}
