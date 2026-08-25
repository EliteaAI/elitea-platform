package toolkits

// Real-database proof for #381: a tool-list read that fails must not answer
// with an empty tool list.
//
// The handler tests in handler_test.go inject the failure at the Repository
// seam, so they prove the handler contract but not the repository that produces
// it — and the repository was the first of the two swallows. `pool.Query` errors
// became `[]Tool{}, nil` there, so the handler branch could never run. These
// tests therefore drive the real pgRepo against a real PostgreSQL service and
// make the read fail for real:
//
//   - a tenant schema that does not exist (the case the issue names: a new
//     project has no tenant data yet), and
//   - a table that is dropped under a schema that does exist.
//
// Both are read faults that the caller cannot fix by adding tools.
//
// The empty case and the populated case run against the same fixture, because
// one alone does not discriminate: a repository that returns an error for
// everything passes the failure test, and a repository that returns an empty
// list for everything passes the empty test.
//
// Requires a PostgreSQL service (ELITEA_TEST_DATABASE_URL); the shared helper in
// create_toolkit_owner_id_test.go creates a throwaway database per test.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db"
)

// toolListFixture is one migrated tenant schema (p_1) holding two toolkits of
// type "github" attached to entity version 42, and nothing attached to entity
// version 43.
type toolListFixture struct {
	pool   *pgxpool.Pool
	router chi.Router
}

const (
	populatedVersionID = "42"
	emptyVersionID     = "43"
	// p_9999 is never created by the migrations, so every statement against it
	// fails with an undefined-table error.
	missingSchemaProjectID = "9999"
)

func newToolListFixture(t *testing.T) *toolListFixture {
	t.Helper()
	pool := newToolkitsIntegrationPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	if err := db.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("run baseline migrations: %v", err)
	}

	for _, tool := range []struct{ name, description string }{
		{"github-primary", "the first attached tool"},
		{"github-secondary", ""},
	} {
		var toolID int64
		if err := pool.QueryRow(ctx, `
			INSERT INTO p_1.elitea_tools (name, type, description, owner_id, author_id)
			VALUES ($1, 'github', NULLIF($2, ''), 1, 7) RETURNING id`,
			tool.name, tool.description).Scan(&toolID); err != nil {
			t.Fatalf("insert %s: %v", tool.name, err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO p_1.entity_tool_mapping (entity_version_id, entity_type, tool_id)
			VALUES ($1, 'application', $2)`, populatedVersionID, toolID); err != nil {
			t.Fatalf("attach %s: %v", tool.name, err)
		}
	}

	// The two routes as router.go mounts them, over the real pgRepo.
	router := chi.NewRouter()
	handler := NewHandler(pool)
	router.Get("/toolkit_available_tools/prompt_lib/{projectID}/{toolkitID}", handler.AvailableTools)
	router.Post("/toolkit_discover_tools/prompt_lib/{projectID}/{toolkitType}", handler.DiscoverTools)
	return &toolListFixture{pool: pool, router: router}
}

func (f *toolListFixture) availableTools(t *testing.T, projectID, versionID string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet,
		"/toolkit_available_tools/prompt_lib/"+projectID+"/"+versionID, nil))
	return rec
}

func (f *toolListFixture) discoverTools(t *testing.T, projectID, toolkitType string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost,
		"/toolkit_discover_tools/prompt_lib/"+projectID+"/"+toolkitType, nil))
	return rec
}

// decodeToolList reads a success body. It fails the test if the body is a
// failure body, so a test that expects tools cannot pass on an error.
func decodeToolList(t *testing.T, rec *httptest.ResponseRecorder) []map[string]any {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Tools []map[string]any `json:"tools"`
		Total int              `json:"total"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Total != len(resp.Tools) {
		t.Errorf("total is %d but the list holds %d tools", resp.Total, len(resp.Tools))
	}
	return resp.Tools
}

// assertRealReadFault states the failure contract against the real repository:
// a failure status, the named reason, and no tool list at all.
func assertRealReadFault(t *testing.T, rec *httptest.ResponseRecorder, wantReason string) {
	t.Helper()
	if rec.Code == http.StatusOK {
		t.Fatalf("a failed database read answered 200; body: %s", rec.Body.String())
	}
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d; body: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, hasTools := resp["tools"]; hasTools {
		t.Errorf("a failed database read carried a tools list: %#v", resp)
	}
	if reason, _ := resp["error"].(string); reason != wantReason {
		t.Errorf("error = %q, want the named reason %q", reason, wantReason)
	}
}

// Direction one: a read that works still returns its tools. This test also
// covers the second swallowed error — the per-row `continue` — because a scan
// that fails for every row produced the same empty list as an unattached
// toolkit, and nothing here would have told the two apart.
func TestAvailableToolsReturnsTheAttachedToolsFromTheDatabase(t *testing.T) {
	fixture := newToolListFixture(t)

	tools := decodeToolList(t, fixture.availableTools(t, "1", populatedVersionID))
	if len(tools) != 2 {
		t.Fatalf("expected the 2 attached tools, got %d: %#v", len(tools), tools)
	}
	names := map[string]bool{}
	for _, tool := range tools {
		name, _ := tool["name"].(string)
		names[name] = true
		if id, _ := tool["id"].(string); id == "" {
			t.Errorf("tool %q came back with no id: %#v", name, tool)
		}
		if toolType, _ := tool["type"].(string); toolType != "github" {
			t.Errorf("tool %q has type %q, want github", name, toolType)
		}
	}
	for _, want := range []string{"github-primary", "github-secondary"} {
		if !names[want] {
			t.Errorf("%q is missing from the response: %#v", want, tools)
		}
	}
}

// Direction two, half one: a toolkit that really has no tools keeps the empty
// success answer.
func TestAvailableToolsReturnsAnEmptyListForAToolkitWithNoTools(t *testing.T) {
	fixture := newToolListFixture(t)

	tools := decodeToolList(t, fixture.availableTools(t, "1", emptyVersionID))
	if len(tools) != 0 {
		t.Fatalf("expected no tools, got %d: %#v", len(tools), tools)
	}
	if body := fixture.availableTools(t, "1", emptyVersionID).Body.String(); !jsonHasEmptyToolsArray(body) {
		t.Errorf("an empty result must encode as \"tools\":[], got %s", body)
	}
}

// Direction two, half two: the same route, the same shape of request, and a
// database read that cannot answer. The tenant schema does not exist.
func TestAvailableToolsReportsAMissingTenantSchemaAsAFailure(t *testing.T) {
	fixture := newToolListFixture(t)

	assertRealReadFault(t, fixture.availableTools(t, missingSchemaProjectID, populatedVersionID),
		"available tools read failed")
}

// The same fault from the other direction: the schema exists and the table is
// gone. This is the shape a partial migration leaves behind.
func TestAvailableToolsReportsADroppedTableAsAFailure(t *testing.T) {
	fixture := newToolListFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if _, err := fixture.pool.Exec(ctx, `DROP TABLE p_1.entity_tool_mapping`); err != nil {
		t.Fatalf("drop the mapping table: %v", err)
	}

	assertRealReadFault(t, fixture.availableTools(t, "1", populatedVersionID),
		"available tools read failed")
}

func TestDiscoverToolsReturnsTheTypesToolsFromTheDatabase(t *testing.T) {
	fixture := newToolListFixture(t)

	tools := decodeToolList(t, fixture.discoverTools(t, "1", "github"))
	if len(tools) != 2 {
		t.Fatalf("expected the 2 github toolkits, got %d: %#v", len(tools), tools)
	}
}

func TestDiscoverToolsReturnsAnEmptyListForATypeWithNoTools(t *testing.T) {
	fixture := newToolListFixture(t)

	if tools := decodeToolList(t, fixture.discoverTools(t, "1", "jira")); len(tools) != 0 {
		t.Fatalf("expected no tools, got %d: %#v", len(tools), tools)
	}
}

func TestDiscoverToolsReportsAMissingTenantSchemaAsAFailure(t *testing.T) {
	fixture := newToolListFixture(t)

	assertRealReadFault(t, fixture.discoverTools(t, missingSchemaProjectID, "github"),
		"discover tools read failed")
}

// A row that fails to scan is a failure, not a shorter list (#381 AC4). The
// column type changes under the query, which is what a bad migration does. The
// old `continue` dropped every such row and answered 200 with the rows that
// were left — an empty list when all rows fail.
func TestAvailableToolsReportsARowThatFailsToScanAsAFailure(t *testing.T) {
	fixture := newToolListFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if _, err := fixture.pool.Exec(ctx,
		`ALTER TABLE p_1.elitea_tools ALTER COLUMN name TYPE bytea USING name::bytea`); err != nil {
		t.Fatalf("change the name column type: %v", err)
	}

	assertRealReadFault(t, fixture.availableTools(t, "1", populatedVersionID),
		"available tools read failed")
}

func jsonHasEmptyToolsArray(body string) bool {
	var resp map[string]json.RawMessage
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		return false
	}
	raw, ok := resp["tools"]
	return ok && string(raw) == "[]"
}
