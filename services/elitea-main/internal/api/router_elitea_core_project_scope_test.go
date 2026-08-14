package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"

	v2convs "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/conversations"
	v2folders "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/folders"
	v2skills "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
	v2tags "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/tags"
)

// ---------------------------------------------------------------------------
// #302 — /elitea_core project-scoped routes must refuse another project.
//
// Every handler in this group derives its tenant schema from the {projectID}
// path segment (tenantSchema(projectID), fmt.Sprintf("p_%s", projectID)) and
// none reads the caller's membership, so before this change any authenticated
// principal could read and mutate any project by editing that segment.
// ---------------------------------------------------------------------------

// memberOfProject answers the membership EXISTS query for exactly one project
// and denies every other, which is what the real query does: it keys on
// (project_id, user_id) in auth_core__project_user_role, so a user with no
// role assignment in the named project resolves to no membership.
//
// It records the project ids it was asked about, so a test can prove the gate
// actually ran rather than inferring it from a status code that some other
// layer might also produce.
type memberOfProject struct {
	project string
	asked   []string
}

func (m *memberOfProject) QueryRow(_ context.Context, _ string, args ...any) pgx.Row {
	projectID := ""
	if len(args) > 0 {
		switch v := args[0].(type) {
		case int:
			projectID = strconv.Itoa(v)
		case string:
			projectID = v
		}
	}
	m.asked = append(m.asked, projectID)
	return membershipRow{allowed: projectID == m.project}
}

type membershipRow struct{ allowed bool }

func (r membershipRow) Scan(dest ...any) error {
	if len(dest) == 1 {
		if target, ok := dest[0].(*bool); ok {
			*target = r.allowed
		}
	}
	return nil
}

// eliteaCoreProjectScopedRoute is one gated registration. The permission
// column the artifact table carries has no counterpart yet: #302 is closed at
// the MEMBERSHIP tier, because a Go-bootstrapped database grants six
// default-mode permissions and these routes need roughly fifty (see the
// projectScoped comment in router.go). When the seeding migration lands, this
// table is where the permission column belongs.
type eliteaCoreProjectScopedRoute struct {
	method string
	// ownPath and otherPath differ ONLY in the project segment. Anything else
	// differing would let a 403 come from routing rather than from the gate.
	ownPath   string
	otherPath string
}

// The families #302 names: applications, skills, folders, tags, conversations,
// fork, publish and unpublish. One row per verb-bearing shape rather than one
// per registration, since every row in a family shares the one middleware.
var eliteaCoreProjectScopedRoutes = []eliteaCoreProjectScopedRoute{
	{http.MethodGet, "/api/v2/elitea_core/applications/prompt_lib/7", "/api/v2/elitea_core/applications/prompt_lib/8"},
	{http.MethodPost, "/api/v2/elitea_core/applications/prompt_lib/7", "/api/v2/elitea_core/applications/prompt_lib/8"},
	{http.MethodGet, "/api/v2/elitea_core/application/prompt_lib/7/1", "/api/v2/elitea_core/application/prompt_lib/8/1"},
	{http.MethodPut, "/api/v2/elitea_core/application/prompt_lib/7/1", "/api/v2/elitea_core/application/prompt_lib/8/1"},
	{http.MethodDelete, "/api/v2/elitea_core/application/prompt_lib/7/1", "/api/v2/elitea_core/application/prompt_lib/8/1"},
	{http.MethodDelete, "/api/v2/elitea_core/version/prompt_lib/7/1/2", "/api/v2/elitea_core/version/prompt_lib/8/1/2"},
	{http.MethodPatch, "/api/v2/elitea_core/default_version/prompt_lib/7/1/2", "/api/v2/elitea_core/default_version/prompt_lib/8/1/2"},
	{http.MethodGet, "/api/v2/elitea_core/skills/prompt_lib/7", "/api/v2/elitea_core/skills/prompt_lib/8"},
	{http.MethodPost, "/api/v2/elitea_core/skills/prompt_lib/7", "/api/v2/elitea_core/skills/prompt_lib/8"},
	{http.MethodDelete, "/api/v2/elitea_core/skill/prompt_lib/7/1", "/api/v2/elitea_core/skill/prompt_lib/8/1"},
	{http.MethodPost, "/api/v2/elitea_core/skill_import/prompt_lib/7", "/api/v2/elitea_core/skill_import/prompt_lib/8"},
	{http.MethodGet, "/api/v2/elitea_core/folder/prompt_lib/7", "/api/v2/elitea_core/folder/prompt_lib/8"},
	{http.MethodPost, "/api/v2/elitea_core/folder/prompt_lib/7", "/api/v2/elitea_core/folder/prompt_lib/8"},
	{http.MethodDelete, "/api/v2/elitea_core/folder/prompt_lib/7/1", "/api/v2/elitea_core/folder/prompt_lib/8/1"},
	{http.MethodGet, "/api/v2/elitea_core/tags/prompt_lib/7", "/api/v2/elitea_core/tags/prompt_lib/8"},
	{http.MethodPost, "/api/v2/elitea_core/tags/prompt_lib/7", "/api/v2/elitea_core/tags/prompt_lib/8"},
	{http.MethodDelete, "/api/v2/elitea_core/tags/prompt_lib/7/1", "/api/v2/elitea_core/tags/prompt_lib/8/1"},
	{http.MethodGet, "/api/v2/elitea_core/conversations/prompt_lib/7", "/api/v2/elitea_core/conversations/prompt_lib/8"},
	{http.MethodPost, "/api/v2/elitea_core/conversations/prompt_lib/7", "/api/v2/elitea_core/conversations/prompt_lib/8"},
	{http.MethodDelete, "/api/v2/elitea_core/conversation/prompt_lib/7/1", "/api/v2/elitea_core/conversation/prompt_lib/8/1"},
	{http.MethodDelete, "/api/v2/elitea_core/messages/prompt_lib/7/1", "/api/v2/elitea_core/messages/prompt_lib/8/1"},
	{http.MethodPost, "/api/v2/elitea_core/attachments/prompt_lib/7/1", "/api/v2/elitea_core/attachments/prompt_lib/8/1"},
	{http.MethodDelete, "/api/v2/elitea_core/attachments/prompt_lib/7/1", "/api/v2/elitea_core/attachments/prompt_lib/8/1"},
	{http.MethodPost, "/api/v2/elitea_core/fork/prompt_lib/7", "/api/v2/elitea_core/fork/prompt_lib/8"},
	{http.MethodPost, "/api/v2/elitea_core/publish/prompt_lib/7/1", "/api/v2/elitea_core/publish/prompt_lib/8/1"},
	{http.MethodPost, "/api/v2/elitea_core/unpublish/prompt_lib/7/1", "/api/v2/elitea_core/unpublish/prompt_lib/8/1"},
	{http.MethodPost, "/api/v2/elitea_core/publish_validate/prompt_lib/7/1", "/api/v2/elitea_core/publish_validate/prompt_lib/8/1"},
	{http.MethodPost, "/api/v2/elitea_core/version_validator/prompt_lib/7/1/2", "/api/v2/elitea_core/version_validator/prompt_lib/8/1/2"},
	{http.MethodPost, "/api/v2/elitea_core/batch_replace_version/prompt_lib/7/1/2", "/api/v2/elitea_core/batch_replace_version/prompt_lib/8/1/2"},
	{http.MethodPut, "/api/v2/elitea_core/application_attachment_storage/prompt_lib/7/1/2", "/api/v2/elitea_core/application_attachment_storage/prompt_lib/8/1/2"},
}

// newEliteaCoreProjectScopeRouter composes every repo these families gate on,
// so all the routes are registered, and injects the membership answer.
//
// The repositories are empty structs embedding the interface: they answer for
// ANY project id, exactly as alwaysSucceedsArtifactRepo does in
// router_artifacts_s3_test.go. That is deliberate and it is what makes the
// test meaningful — a repo that refused project 8 on its own would let the
// test pass without proving anything about authorization, so a refusal here
// can only have come from the gate in front of the handler.
func newEliteaCoreProjectScopeRouter(querier *memberOfProject) http.Handler {
	return NewRouter(RouterConfig{
		AuthValidator:        testTokenValidator{user: authenticatedTestUser()},
		AppsRepo:             struct{ applications.Repository }{},
		SkillsRepo:           struct{ v2skills.Repository }{},
		FoldersRepo:          struct{ v2folders.Repository }{},
		TagsRepo:             struct{ v2tags.Repository }{},
		ConvsRepo:            struct{ v2convs.Repository }{},
		ProjectAccessQuerier: querier,
	})
}

// TestEliteaCoreRoutesRefuseAnotherProject is #302's central claim. The
// principal is genuinely entitled to project 7. The only thing that changes
// between the two halves of each row is the project id in the path.
//
// Every row FAILS on the pre-#302 router: without the gate the request reaches
// the handler, which builds p_8 from the path segment and answers something
// other than 403.
func TestEliteaCoreRoutesRefuseAnotherProject(t *testing.T) {
	for _, route := range eliteaCoreProjectScopedRoutes {
		t.Run(route.method+" "+route.otherPath, func(t *testing.T) {
			querier := &memberOfProject{project: "7"}
			router := newEliteaCoreProjectScopeRouter(querier)

			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, testAuthHeader(httptest.NewRequest(route.method, route.otherPath, nil)))

			if recorder.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403 — the {projectID} path segment must not be "+
					"trusted as an authorization claim (#302); body=%s",
					recorder.Code, recorder.Body.String())
			}
			// A 403 that the membership query never informed is not this gate.
			// chi answers 403 nowhere else on these paths, but asserting the
			// query ran is what distinguishes "refused because not a member"
			// from "refused for some unrelated reason".
			if len(querier.asked) != 1 || querier.asked[0] != "8" {
				t.Fatalf("membership was checked for %v, want exactly [8]: the 403 did not "+
					"come from the project-access gate", querier.asked)
			}
		})
	}
}

// TestEliteaCoreRoutesAdmitTheCallersOwnProject is the control. Without it the
// test above would also pass against a router that refused EVERY request —
// including one that broke these routes outright, which is the realistic
// failure mode of adding a gate whose backing grant is missing.
//
// It asserts "not 403" rather than a specific success code because the empty
// embedded repositories panic-free return zero values and each handler shapes
// its own response; what matters is that authorization let the request past.
func TestEliteaCoreRoutesAdmitTheCallersOwnProject(t *testing.T) {
	for _, route := range eliteaCoreProjectScopedRoutes {
		t.Run(route.method+" "+route.ownPath, func(t *testing.T) {
			querier := &memberOfProject{project: "7"}
			router := newEliteaCoreProjectScopeRouter(querier)

			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, testAuthHeader(httptest.NewRequest(route.method, route.ownPath, nil)))

			if recorder.Code == http.StatusForbidden {
				t.Fatalf("status = 403 for the caller's OWN project — the gate refuses a "+
					"genuine member, which breaks the route rather than securing it; body=%s",
					recorder.Body.String())
			}
			if recorder.Code == http.StatusNotFound || recorder.Code == http.StatusMethodNotAllowed {
				t.Fatalf("status = %d — the route is not registered, so the 403 assertion in "+
					"TestEliteaCoreRoutesRefuseAnotherProject would prove nothing", recorder.Code)
			}
		})
	}
}

// TestEliteaCoreProjectScopeRejectsMalformedProjectID proves the gate fails
// closed on input the membership query can never answer for. strconv.Atoi is
// what stands between a path segment and the query, so a value it accepts
// loosely — or one that reaches the handler regardless — would be a way past.
func TestEliteaCoreProjectScopeRejectsMalformedProjectID(t *testing.T) {
	for _, projectID := range []string{"0", "-1", "abc", "1.5", "7x"} {
		t.Run("projectID="+projectID, func(t *testing.T) {
			querier := &memberOfProject{project: "7"}
			router := newEliteaCoreProjectScopeRouter(querier)

			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, testAuthHeader(httptest.NewRequest(
				http.MethodDelete, "/api/v2/elitea_core/application/prompt_lib/"+projectID+"/1", nil)))

			if recorder.Code != http.StatusBadRequest && recorder.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 400 or 403 for a malformed project id; body=%s",
					recorder.Code, recorder.Body.String())
			}
			if len(querier.asked) != 0 {
				t.Fatalf("the membership query ran with %v for a malformed id; it must be "+
					"rejected before any project is named", querier.asked)
			}
		})
	}
}

// TestEliteaCorePublicRoutesStayUnscoped pins the boundary. The public
// catalogues name no project in their path, legacy scopes them globally, and
// #302's acceptance notes forbid tightening routes legacy leaves open. If the
// gate were applied group-wide instead of per-family these would start
// answering 403 with no project to check.
// TestAgentCategoriesStayUnscopedDespiteHavingAProjectInThePath is the case the
// boundary test above could not see. It only covers routes with NO project in
// their path; agent_categories HAS one, so it looks scopable — and gating it
// emptied the Agent HUB's category rail, because the hub renders that list
// beside the ungated public catalogue and a non-member of the named project got
// a 403 where the catalogue beside it answered fine.
//
// The route serves a global taxonomy: nine hardcoded defaults plus a globally
// authored extras row. Its only project-shaped read is a `publishing_guardrail`
// lookup the handler itself documents as one that "could only ever miss",
// because no surface writes one. So there is nothing here to protect, and a
// caller who is not a member must still be served.
func TestAgentCategoriesStayUnscopedDespiteHavingAProjectInThePath(t *testing.T) {
	querier := &memberOfProject{project: "7"}
	router := newEliteaCoreProjectScopeRouter(querier)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, testAuthHeader(
		httptest.NewRequest(http.MethodGet, "/api/v2/elitea_core/agent_categories/prompt_lib/8", nil)))

	if recorder.Code == http.StatusForbidden {
		t.Fatalf("a non-member got 403 from the global category taxonomy; body=%s", recorder.Body.String())
	}
	if len(querier.asked) != 0 {
		t.Fatalf("the membership query ran for a global taxonomy route: %v", querier.asked)
	}
}

func TestEliteaCorePublicRoutesStayUnscoped(t *testing.T) {
	querier := &memberOfProject{project: "7"}
	router := newEliteaCoreProjectScopeRouter(querier)

	for _, path := range []string{
		"/api/v2/elitea_core/public_applications/prompt_lib/",
		"/api/v2/elitea_core/public_skills/prompt_lib/",
	} {
		t.Run(path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, testAuthHeader(httptest.NewRequest(http.MethodGet, path, nil)))
			if recorder.Code == http.StatusForbidden {
				t.Fatalf("status = 403 on a route with no project in its path; body=%s",
					recorder.Body.String())
			}
		})
	}
	if len(querier.asked) != 0 {
		t.Fatalf("the membership query ran for a project-less route: %v", querier.asked)
	}
}
