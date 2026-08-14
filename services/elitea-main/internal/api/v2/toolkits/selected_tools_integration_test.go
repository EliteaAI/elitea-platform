package toolkits

// Write-then-RE-READ tests for the per-mapping `selected_tools` list (#248).
//
// `p_<project>.entity_tool_mapping.selected_tools` has existed since
// 001_initial.sql and NOTHING wrote it: `updateToolRelation` answered 201 for
// every relation PATCH while its INSERT named four columns, none of them
// `selected_tools`, under an unconditional `ON CONFLICT ... DO NOTHING`. A
// handler test that stops at the status code passes against that code
// unchanged, which is exactly how the gap survived (#128's lesson) — so every
// assertion below reads the STORED ROW, and the first one also round-trips the
// value back out through the read path the editor actually reloads from
// (`applications.Handler.GetVersion` -> `fetchVersionDetails`).
//
// Requires a PostgreSQL service (ELITEA_TEST_DATABASE_URL); the shared helper
// in create_toolkit_owner_id_test.go creates a throwaway database per test.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/applications"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db"
)

// relationFixture is one project schema holding one application, one draft
// version and one toolkit instance, reachable through the same two routes the
// router mounts for this flow: the relation PATCH that owns the mapping row,
// and the version GET the editor reloads from.
type relationFixture struct {
	pool          *pgxpool.Pool
	router        chi.Router
	applicationID int64
	versionID     int64
	toolkitID     int64
}

func newRelationFixture(t *testing.T) *relationFixture {
	t.Helper()
	pool := newToolkitsIntegrationPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	if err := db.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("run baseline migrations: %v", err)
	}

	// PRE-EXISTING, SEPARATE DEFECT, measured here rather than assumed: the
	// baseline migration's `entity_tool_mapping` has NO `entity_id` column
	// (001_initial.sql:451-460 — verified by reading information_schema on a
	// freshly migrated database), while the production pylon schema this
	// service inherits has `entity_id integer NOT NULL`
	// (internal/db/schema/agent_chat_baseline.sql:104-113) and EVERY writer in
	// this codebase names it: this handler's attach INSERT, eliteacore's
	// clone/import INSERTs, and the chat query's own join
	// (internal/db/queries/agent_chat.sql:107). So on a fresh Go-migrated
	// database every attach 500s ("column entity_id ... does not exist")
	// before `selected_tools` is even reached. This test is about
	// `selected_tools`, not about that gap, so the fixture brings the table up
	// to the shape every deployed instance actually has. Fixing the migration
	// is a separate change (it cannot be an edit to 001_initial.sql — applied
	// migrations are checksum-immutable).
	if _, err := pool.Exec(ctx, `ALTER TABLE p_1.entity_tool_mapping ADD COLUMN IF NOT EXISTS entity_id INTEGER`); err != nil {
		t.Fatalf("align the fixture table with the deployed schema: %v", err)
	}

	var applicationID, versionID, toolkitID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO p_1.applications (name, description, owner_id)
		VALUES ('selected-tools-fixture', '', 1) RETURNING id`).Scan(&applicationID); err != nil {
		t.Fatalf("insert fixture application: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO p_1.application_versions (application_id, name, status, author_id)
		VALUES ($1, 'base', 'draft', 7) RETURNING id`, applicationID).Scan(&versionID); err != nil {
		t.Fatalf("insert fixture version: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO p_1.elitea_tools (name, type, description, settings, meta, owner_id, author_id)
		VALUES ('selected-tools-fixture', 'github', '', '{}'::jsonb, '{}'::jsonb, 1, 7)
		RETURNING id`).Scan(&toolkitID); err != nil {
		t.Fatalf("insert fixture toolkit: %v", err)
	}

	router := chi.NewRouter()
	router.Patch("/tool/prompt_lib/{projectID}/{toolkitID}", NewHandler(pool).Update)
	// repo is nil on purpose: fetchVersionDetails takes its pool-backed branch
	// whenever a pool is supplied, which is the branch this test is about.
	router.Get("/version/prompt_lib/{projectID}/{applicationID}/{versionID}", applications.NewHandler(nil, pool).GetVersion)

	return &relationFixture{pool: pool, router: router, applicationID: applicationID, versionID: versionID, toolkitID: toolkitID}
}

func (f *relationFixture) patchRelation(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	path := "/tool/prompt_lib/1/" + strconv.FormatInt(f.toolkitID, 10)
	request := httptest.NewRequest(http.MethodPatch, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	f.router.ServeHTTP(recorder, request)
	return recorder
}

// attachBody is the ATTACH request `ToolMenu` sends: no `selected_tools` key.
func (f *relationFixture) attachBody() string {
	return `{"entity_version_id": ` + strconv.FormatInt(f.versionID, 10) +
		`, "entity_id": ` + strconv.FormatInt(f.applicationID, 10) +
		`, "entity_type": "agent", "has_relation": true}`
}

// selectionBody is the SELECTION EDIT request the tool card sends: the same
// relation PATCH, plus the full resulting list.
func (f *relationFixture) selectionBody(selectedTools string) string {
	return `{"entity_version_id": ` + strconv.FormatInt(f.versionID, 10) +
		`, "entity_id": ` + strconv.FormatInt(f.applicationID, 10) +
		`, "entity_type": "agent", "has_relation": true, "selected_tools": ` + selectedTools + `}`
}

// storedSelectedTools re-reads the column the write claims to have set.
func (f *relationFixture) storedSelectedTools(t *testing.T) string {
	t.Helper()
	var stored string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT COALESCE(selected_tools::text, 'null') FROM p_1.entity_tool_mapping
		 WHERE entity_version_id = $1 AND tool_id = $2 AND entity_type = 'agent'`,
		f.versionID, f.toolkitID,
	).Scan(&stored); err != nil {
		t.Fatalf("re-read the mapping row: %v", err)
	}
	return stored
}

// readBackSelectedTools goes the whole way round: the version GET the editor
// reloads from, down to the tool row's own `selected_tools`.
func (f *relationFixture) readBackSelectedTools(t *testing.T) []any {
	t.Helper()
	path := "/version/prompt_lib/1/" + strconv.FormatInt(f.applicationID, 10) + "/" + strconv.FormatInt(f.versionID, 10)
	recorder := httptest.NewRecorder()
	f.router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET version = %d, want 200: %s", recorder.Code, recorder.Body.String())
	}
	var details struct {
		Tools []struct {
			ToolID        int   `json:"tool_id"`
			SelectedTools []any `json:"selected_tools"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &details); err != nil {
		t.Fatalf("decode version details: %v\n%s", err, recorder.Body.String())
	}
	for _, tool := range details.Tools {
		if int64(tool.ToolID) == f.toolkitID {
			return tool.SelectedTools
		}
	}
	t.Fatalf("the version's tools[] carries no row for tool_id %d: %s", f.toolkitID, recorder.Body.String())
	return nil
}

// The defect itself: the checkbox list the card sends must reach the column and
// come back out again. Fails before the fix at the stored-row assertion — the
// row exists (attach worked all along) with selected_tools still '[]'.
func TestRelationPatchPersistsSelectedToolsAndReadsThemBack(t *testing.T) {
	fixture := newRelationFixture(t)

	if code := fixture.patchRelation(t, fixture.attachBody()).Code; code != http.StatusCreated {
		t.Fatalf("attach = %d, want 201", code)
	}
	if code := fixture.patchRelation(t, fixture.selectionBody(`["create_issue","get_issue"]`)).Code; code != http.StatusCreated {
		t.Fatalf("selection edit = %d, want 201", code)
	}

	if stored := fixture.storedSelectedTools(t); stored != `["create_issue", "get_issue"]` {
		t.Errorf("stored selected_tools = %s, want [\"create_issue\", \"get_issue\"]", stored)
	}
	readBack := fixture.readBackSelectedTools(t)
	if len(readBack) != 2 || readBack[0] != "create_issue" || readBack[1] != "get_issue" {
		t.Errorf("version_details.tools[].selected_tools = %#v, want [create_issue get_issue]", readBack)
	}
}

// The ABSENT-vs-EMPTY rule, asserted directly. An attach carries no
// `selected_tools` key; it must leave a previously saved selection alone. An
// explicit `[]` is a real edit ("I unchecked the last one") and must land.
func TestRelationPatchDistinguishesAnAbsentSelectionFromAnEmptyOne(t *testing.T) {
	fixture := newRelationFixture(t)

	fixture.patchRelation(t, fixture.selectionBody(`["create_issue"]`))
	if stored := fixture.storedSelectedTools(t); stored != `["create_issue"]` {
		t.Fatalf("setup: stored selected_tools = %s, want [\"create_issue\"]", stored)
	}

	// Absent key: preserve.
	if code := fixture.patchRelation(t, fixture.attachBody()).Code; code != http.StatusCreated {
		t.Fatalf("re-attach = %d, want 201", code)
	}
	if stored := fixture.storedSelectedTools(t); stored != `["create_issue"]` {
		t.Errorf("a request with no selected_tools key changed the stored selection to %s — an attach must not wipe a saved selection", stored)
	}

	// Explicit empty list: write it.
	if code := fixture.patchRelation(t, fixture.selectionBody(`[]`)).Code; code != http.StatusCreated {
		t.Fatalf("empty selection edit = %d, want 201", code)
	}
	if stored := fixture.storedSelectedTools(t); stored != `[]` {
		t.Errorf("stored selected_tools = %s, want [] — unchecking the last tool is a real edit", stored)
	}
}

// A malformed list is rejected rather than stored: the column is read straight
// back into `version_details.tools[].selected_tools`, which the UI indexes as a
// list of strings.
func TestRelationPatchRejectsANonStringSelectedToolsList(t *testing.T) {
	fixture := newRelationFixture(t)

	fixture.patchRelation(t, fixture.selectionBody(`["create_issue"]`))
	if code := fixture.patchRelation(t, fixture.selectionBody(`[{"name":"create_issue"}]`)).Code; code != http.StatusBadRequest {
		t.Errorf("selection edit with object entries = %d, want 400", code)
	}
	if code := fixture.patchRelation(t, fixture.selectionBody(`"create_issue"`)).Code; code != http.StatusBadRequest {
		t.Errorf("selection edit with a bare string = %d, want 400", code)
	}
	if stored := fixture.storedSelectedTools(t); stored != `["create_issue"]` {
		t.Errorf("a rejected request changed the stored selection to %s", stored)
	}
}
