package oapiserver

// Real-PostgreSQL coverage for the two attachment-copy paths in this package:
// ForkAgent (publishing.go) and UpdateApplicationRelation (versions.go).
//
// Both used to write nothing on every deployment. Their INSERTs omitted
// `entity_type` — NOT NULL with no default in the bootstrap table
// (internal/infra/db/migrations/001_initial.sql:422-431 and :451-460) and in the
// inherited pylon shape (internal/db/schema/agent_chat_baseline.sql:104-153) —
// so each raised 23502, and each was written `_, _ = pool.Exec(...)`, which made
// a permanently failing statement indistinguishable from a working one.
//
// So these tests deliberately never assert on the handler's status code alone.
// A 200 from ForkAgent is exactly what the defect produced; the assertions below
// read the mapping rows back out of the database.
//
// The schema comes from the REAL migration corpus — db.RunMigrations (the
// 001_initial bootstrap, which is what creates p_1 and its tables) followed by
// migrate.Runner.ApplyShared/ApplyTenant, which is the production chain and the
// only way migration 0125's `entity_id NOT NULL` is in scope. A hand-built
// fixture that declares the table with every column and no NOT NULL is how this
// class of defect survives.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/migrate"
	platformmigrations "github.com/EliteaAI/elitea-platform/services/elitea-main/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const attachmentIntegrationDatabaseURL = "ELITEA_TEST_DATABASE_URL"

// attachmentFixture is one agent in p_1 with one toolkit and one skill attached
// to its single version.
type attachmentFixture struct {
	appID         int
	versionID     int
	toolID        int
	skillID       int
	skillVersion  int
	selectedTools string
}

func TestForkAgentCarriesToolAndSkillAttachments(t *testing.T) {
	pool := newAttachmentIntegrationPool(t)
	fixture := seedAttachmentFixture(t, pool)
	server := New(Config{Pool: pool})

	body, err := json.Marshal(map[string]any{
		"application_id":    fixture.appID,
		"target_project_id": "1",
	})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v2/applications/fork/1", bytes.NewReader(body))
	server.ForkAgent(recorder, request, "1")

	if recorder.Code != http.StatusOK {
		t.Fatalf("fork status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		ID int `json:"id"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode fork response %q: %v", recorder.Body.String(), err)
	}
	if response.ID == 0 || response.ID == fixture.appID {
		t.Fatalf("fork returned application id %d (source was %d)", response.ID, fixture.appID)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// The version must exist before its attachments can mean anything: the copy
	// used to name a `prompt` column no schema has, which left the fork with an
	// application and no versions at all.
	var newVersionID int
	if err := pool.QueryRow(ctx, `
SELECT id FROM p_1.application_versions WHERE application_id = $1`, response.ID).Scan(&newVersionID); err != nil {
		t.Fatalf("forked application has no version: %v", err)
	}

	var toolID, entityID int
	var entityType, selectedTools string
	if err := pool.QueryRow(ctx, `
SELECT tool_id, entity_id, entity_type, COALESCE(selected_tools::text, '')
FROM p_1.entity_tool_mapping WHERE entity_version_id = $1`, newVersionID).
		Scan(&toolID, &entityID, &entityType, &selectedTools); err != nil {
		t.Fatalf("forked version carries no tool attachment: %v", err)
	}
	if toolID != fixture.toolID {
		t.Errorf("copied tool_id = %d, want %d", toolID, fixture.toolID)
	}
	// The fork's own application, not the source's — see migration 0125 and the
	// chat read's join on entity_id = application_version.application_id.
	if entityID != response.ID {
		t.Errorf("copied entity_id = %d, want the forked application %d", entityID, response.ID)
	}
	if entityType != "agent" {
		t.Errorf("copied entity_type = %q, want %q", entityType, "agent")
	}
	if selectedTools != fixture.selectedTools {
		t.Errorf("copied selected_tools = %q, want %q", selectedTools, fixture.selectedTools)
	}

	var skillID, skillVersionID int
	var skillEntityType string
	if err := pool.QueryRow(ctx, `
SELECT skill_id, skill_version_id, entity_type
FROM p_1.entity_skill_mapping WHERE entity_version_id = $1`, newVersionID).
		Scan(&skillID, &skillVersionID, &skillEntityType); err != nil {
		t.Fatalf("forked version carries no skill attachment: %v", err)
	}
	if skillID != fixture.skillID || skillVersionID != fixture.skillVersion {
		t.Errorf("copied skill = (%d, %d), want (%d, %d)", skillID, skillVersionID, fixture.skillID, fixture.skillVersion)
	}
	if skillEntityType != "agent" {
		t.Errorf("copied skill entity_type = %q, want %q", skillEntityType, "agent")
	}
}

// A fork that cannot copy its attachments must not leave a half-built agent
// behind: the caller sees the failure and can retry, rather than keeping a shell
// that lost the toolkits which made it an agent.
func TestForkAgentRollsBackWhenAttachmentCopyFails(t *testing.T) {
	pool := newAttachmentIntegrationPool(t)
	fixture := seedAttachmentFixture(t, pool)
	server := New(Config{Pool: pool})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Make the tool-mapping copy the statement that fails, without touching the
	// application or version copies before it.
	if _, err := pool.Exec(ctx, fmt.Sprintf(`
ALTER TABLE p_1.entity_tool_mapping ADD CONSTRAINT copy_must_fail CHECK (entity_version_id < %d)`, fixture.versionID+1)); err != nil {
		t.Fatalf("install failing constraint: %v", err)
	}

	var applicationsBefore int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM p_1.applications`).Scan(&applicationsBefore); err != nil {
		t.Fatal(err)
	}

	body, err := json.Marshal(map[string]any{"application_id": fixture.appID, "target_project_id": "1"})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	server.ForkAgent(recorder, httptest.NewRequest(http.MethodPost, "/api/v2/applications/fork/1", bytes.NewReader(body)), "1")

	if recorder.Code == http.StatusOK {
		t.Fatalf("fork reported success while the attachment copy failed: %s", recorder.Body.String())
	}
	var applicationsAfter int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM p_1.applications`).Scan(&applicationsAfter); err != nil {
		t.Fatal(err)
	}
	if applicationsAfter != applicationsBefore {
		t.Fatalf("failed fork left %d applications behind (had %d)", applicationsAfter-applicationsBefore, applicationsBefore)
	}
}

func TestUpdateApplicationRelationWritesAttachments(t *testing.T) {
	pool := newAttachmentIntegrationPool(t)
	fixture := seedAttachmentFixture(t, pool)
	server := New(Config{Pool: pool})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// A second toolkit so the replace has something new to write.
	var otherToolID int
	if err := pool.QueryRow(ctx, `
INSERT INTO p_1.elitea_tools (name, type, description, owner_id, author_id)
VALUES ('second toolkit', 'github', '', 1, 1) RETURNING id`).Scan(&otherToolID); err != nil {
		t.Fatal(err)
	}

	body, err := json.Marshal(map[string]any{
		"skills": []string{fmt.Sprint(fixture.skillID)},
		"tools":  []string{fmt.Sprint(otherToolID)},
	})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/v2/applications/relation/1", bytes.NewReader(body))
	server.UpdateApplicationRelation(recorder, request, "1", fixture.appID, fixture.versionID)

	if recorder.Code != http.StatusOK {
		t.Fatalf("update relation status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	var toolID, entityID int
	var entityType string
	if err := pool.QueryRow(ctx, `
SELECT tool_id, entity_id, entity_type FROM p_1.entity_tool_mapping WHERE entity_version_id = $1`, fixture.versionID).
		Scan(&toolID, &entityID, &entityType); err != nil {
		t.Fatalf("relation update wrote no tool mapping: %v", err)
	}
	if toolID != otherToolID {
		t.Errorf("tool_id = %d, want %d", toolID, otherToolID)
	}
	if entityID != fixture.appID {
		t.Errorf("entity_id = %d, want the owning application %d", entityID, fixture.appID)
	}
	if entityType != "agent" {
		t.Errorf("entity_type = %q, want %q", entityType, "agent")
	}

	var skillID int
	var skillEntityType string
	if err := pool.QueryRow(ctx, `
SELECT skill_id, entity_type FROM p_1.entity_skill_mapping WHERE entity_version_id = $1`, fixture.versionID).
		Scan(&skillID, &skillEntityType); err != nil {
		t.Fatalf("relation update wrote no skill mapping: %v", err)
	}
	if skillID != fixture.skillID {
		t.Errorf("skill_id = %d, want %d", skillID, fixture.skillID)
	}
	if skillEntityType != "agent" {
		t.Errorf("skill entity_type = %q, want %q", skillEntityType, "agent")
	}
}

// The replace deletes before it inserts, so a failed insert used to leave the
// version stripped of the attachments it had. The transaction must put them
// back, and the caller must be told.
func TestUpdateApplicationRelationRollsBackFailedReplace(t *testing.T) {
	pool := newAttachmentIntegrationPool(t)
	fixture := seedAttachmentFixture(t, pool)
	server := New(Config{Pool: pool})

	body, err := json.Marshal(map[string]any{
		"skills": []string{},
		"tools":  []string{"424242"}, // no such toolkit: tool_id is an FK
	})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/v2/applications/relation/1", bytes.NewReader(body))
	server.UpdateApplicationRelation(recorder, request, "1", fixture.appID, fixture.versionID)

	if recorder.Code < http.StatusBadRequest {
		t.Fatalf("failed relation update answered %d: %s", recorder.Code, recorder.Body.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var toolID int
	if err := pool.QueryRow(ctx, `
SELECT tool_id FROM p_1.entity_tool_mapping WHERE entity_version_id = $1`, fixture.versionID).Scan(&toolID); err != nil {
		t.Fatalf("failed relation update detached the existing toolkit: %v", err)
	}
	if toolID != fixture.toolID {
		t.Fatalf("tool_id = %d, want the untouched %d", toolID, fixture.toolID)
	}
}

// seedAttachmentFixture creates the agent, its version, one toolkit and one
// skill, and attaches both to the version through the five-column shape the
// production writers use (internal/api/v2/toolkits/handler.go:818).
func seedAttachmentFixture(t *testing.T, pool *pgxpool.Pool) attachmentFixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	fixture := attachmentFixture{selectedTools: `["get_issue", "create_issue"]`}
	if err := pool.QueryRow(ctx, `
INSERT INTO p_1.applications (name, description, owner_id) VALUES ('fixture agent', 'seeded', 1) RETURNING id`).
		Scan(&fixture.appID); err != nil {
		t.Fatalf("seed application: %v", err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO p_1.application_versions (application_id, name, status, author_id, instructions)
VALUES ($1, 'latest', 'draft', 1, 'do the thing') RETURNING id`, fixture.appID).Scan(&fixture.versionID); err != nil {
		t.Fatalf("seed application version: %v", err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO p_1.elitea_tools (name, type, description, owner_id, author_id)
VALUES ('fixture toolkit', 'github', '', 1, 1) RETURNING id`).Scan(&fixture.toolID); err != nil {
		t.Fatalf("seed toolkit: %v", err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO p_1.skills (name, description, owner_id, author_id)
VALUES ('fixture skill', 'seeded', 1, 1) RETURNING id`).Scan(&fixture.skillID); err != nil {
		t.Fatalf("seed skill: %v", err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO p_1.skill_versions (skill_id, name, instructions, author_id)
VALUES ($1, 'base', 'seeded', 1) RETURNING id`, fixture.skillID).Scan(&fixture.skillVersion); err != nil {
		t.Fatalf("seed skill version: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO p_1.entity_tool_mapping (entity_version_id, entity_id, entity_type, tool_id, selected_tools)
VALUES ($1, $2, 'agent', $3, $4::jsonb)`, fixture.versionID, fixture.appID, fixture.toolID, fixture.selectedTools); err != nil {
		t.Fatalf("seed tool attachment: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO p_1.entity_skill_mapping (entity_version_id, entity_type, skill_id, skill_version_id)
VALUES ($1, 'agent', $2, $3)`, fixture.versionID, fixture.skillID, fixture.skillVersion); err != nil {
		t.Fatalf("seed skill attachment: %v", err)
	}
	// Read the seeded selected_tools back in the database's own normalization so
	// the fork assertion compares like with like.
	if err := pool.QueryRow(ctx, `
SELECT selected_tools::text FROM p_1.entity_tool_mapping WHERE entity_version_id = $1`, fixture.versionID).
		Scan(&fixture.selectedTools); err != nil {
		t.Fatalf("read back seeded selected_tools: %v", err)
	}
	return fixture
}

// newAttachmentIntegrationPool opens an isolated database on the server named by
// ELITEA_TEST_DATABASE_URL and applies the production migration chain to it:
// db.RunMigrations (001_initial, which creates centry and the p_1 tenant schema)
// then the checksum-pinned shared and tenant histories, 0125 included.
func newAttachmentIntegrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv(attachmentIntegrationDatabaseURL)
	if databaseURL == "" {
		t.Skipf("set %s to run the PostgreSQL attachment-copy integration test", attachmentIntegrationDatabaseURL)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	adminConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse %s: %v", attachmentIntegrationDatabaseURL, err)
	}
	adminConfig.MaxConns = 4
	adminPool, err := pgxpool.NewWithConfig(ctx, adminConfig)
	if err != nil {
		t.Fatalf("open PostgreSQL admin pool: %v", err)
	}
	if err := adminPool.Ping(ctx); err != nil {
		adminPool.Close()
		t.Fatalf("ping PostgreSQL: %v", err)
	}

	databaseName := fmt.Sprintf("elitea_attach_%d_%d", os.Getpid(), time.Now().UnixNano())
	quotedDatabase := pgx.Identifier{databaseName}.Sanitize()
	if _, err := adminPool.Exec(ctx, "CREATE DATABASE "+quotedDatabase); err != nil {
		adminPool.Close()
		t.Fatalf("create isolated PostgreSQL integration database: %v", err)
	}

	testConfig := adminConfig.Copy()
	testConfig.ConnConfig.Database = databaseName
	testConfig.MaxConns = 8
	pool, err := pgxpool.NewWithConfig(ctx, testConfig)
	if err != nil {
		_, _ = adminPool.Exec(context.Background(), "DROP DATABASE "+quotedDatabase+" WITH (FORCE)")
		adminPool.Close()
		t.Fatalf("open isolated PostgreSQL integration database: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		// 120 s, not the old 20 s to 30 s. This DROP queues behind the
		// CREATE DATABASE calls of every package that `go test ./...` runs at
		// the same time, so the wait is server load and not a hang. Two full
		// runs failed here with "drop isolated ... database: timeout" (#409).
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 120*time.Second)
		defer dropCancel()
		if _, err := adminPool.Exec(dropCtx, "DROP DATABASE "+quotedDatabase+" WITH (FORCE)"); err != nil {
			t.Errorf("drop isolated PostgreSQL integration database: %v", err)
		}
		adminPool.Close()
	})

	if err := db.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("apply bootstrap migrations: %v", err)
	}
	runner := migrate.New(pool, platformmigrations.Files)
	if err := runner.ApplyShared(ctx); err != nil {
		t.Fatalf("apply embedded shared migrations: %v", err)
	}
	if err := runner.ApplyTenant(ctx, 1); err != nil {
		t.Fatalf("apply embedded tenant migrations: %v", err)
	}
	// Guard the point of the whole exercise: if the corpus stopped delivering
	// the NOT NULL columns, these tests would pass against a schema that cannot
	// reproduce the defect.
	assertNotNullMappingColumns(t, pool)
	return pool
}

func assertNotNullMappingColumns(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, required := range []struct{ table, column string }{
		{"entity_tool_mapping", "entity_id"},
		{"entity_tool_mapping", "entity_type"},
		{"entity_skill_mapping", "entity_type"},
	} {
		var notNull bool
		if err := pool.QueryRow(ctx, `
SELECT attnotnull FROM pg_attribute
WHERE attrelid = ('p_1.' || $1)::regclass AND attname = $2 AND NOT attisdropped`,
			required.table, required.column).Scan(&notNull); err != nil {
			t.Fatalf("read p_1.%s.%s: %v", required.table, required.column, err)
		}
		if !notNull {
			t.Fatalf("p_1.%s.%s is not NOT NULL — the migration corpus no longer reproduces the defect", required.table, required.column)
		}
	}
}
