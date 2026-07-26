package applicationskills_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/applicationskills"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCurrentApplicationSkillsRoutePostgresContractAndTenantIsolation(t *testing.T) {
	pool := newCurrentApplicationSkillsPostgresPool(t)
	prepareCurrentApplicationSkillsProjects(t, pool)

	repository, err := handler.NewCurrentApplicationSkillsRepository(pool)
	if err != nil {
		t.Fatal(err)
	}
	route := newCurrentApplicationSkillsRoute(
		t,
		repository,
		currentApplicationSkillsPermissionResolverFunc(
			func(
				context.Context,
				auth.User,
				string,
				string,
			) (auth.PermissionResolution, error) {
				return auth.PermissionResolution{
					UserID:      11,
					Permissions: []string{handler.CurrentApplicationSkillsPermission},
				}, nil
			},
		),
	)

	projectOne := httptest.NewRecorder()
	route.ServeHTTP(projectOne, currentApplicationSkillsRequest(
		http.MethodGet,
		"/api/v2/elitea_core/application_skills/prompt_lib/1/301",
		true,
		"10.0.0.8:43120",
	))
	if projectOne.Code != http.StatusOK {
		t.Fatalf("project one status=%d body=%s", projectOne.Code, projectOne.Body.String())
	}
	var projectOneBody struct {
		Skills    []handler.CurrentApplicationSkill `json:"skills"`
		MaxSkills int                               `json:"max_skills"`
	}
	if err := json.NewDecoder(projectOne.Body).Decode(&projectOneBody); err != nil {
		t.Fatal(err)
	}
	if projectOneBody.MaxSkills != 5 || len(projectOneBody.Skills) != 2 {
		t.Fatalf("project one response=%+v", projectOneBody)
	}
	byID := make(map[int32]handler.CurrentApplicationSkill, len(projectOneBody.Skills))
	for _, skill := range projectOneBody.Skills {
		byID[skill.SkillID] = skill
	}
	present := byID[101]
	if present.Name != "deploy" || present.Description != "Deploy safely" ||
		present.VersionID == nil || *present.VersionID != 201 ||
		present.VersionName != "release" || present.VersionMissing {
		t.Fatalf("present version=%+v icon=%s", present, present.IconMeta)
	}
	var icon map[string]string
	if err := json.Unmarshal(present.IconMeta, &icon); err != nil ||
		icon["url"] != "/icons/deploy.svg" ||
		icon["type"] != "image/svg+xml" {
		t.Fatalf("present icon=%s err=%v", present.IconMeta, err)
	}
	missing := byID[102]
	if missing.Name != "review" || missing.VersionID != nil ||
		missing.VersionName != "unknown" || !missing.VersionMissing ||
		string(missing.IconMeta) != "null" {
		t.Fatalf("missing version=%+v icon=%s", missing, missing.IconMeta)
	}
	if _, found := byID[103]; found {
		t.Fatalf("non-agent mapping escaped filter: %+v", byID[103])
	}

	projectTwo := httptest.NewRecorder()
	route.ServeHTTP(projectTwo, currentApplicationSkillsRequest(
		http.MethodGet,
		"/api/v2/elitea_core/application_skills/prompt_lib/2/301",
		true,
		"10.0.0.8:43120",
	))
	if projectTwo.Code != http.StatusOK {
		t.Fatalf("project two status=%d body=%s", projectTwo.Code, projectTwo.Body.String())
	}
	var projectTwoBody struct {
		Skills []handler.CurrentApplicationSkill `json:"skills"`
	}
	if err := json.NewDecoder(projectTwo.Body).Decode(&projectTwoBody); err != nil {
		t.Fatal(err)
	}
	if len(projectTwoBody.Skills) != 1 ||
		projectTwoBody.Skills[0].Name != "private-project-skill" ||
		projectTwoBody.Skills[0].SkillID != 101 {
		t.Fatalf("project two response=%+v", projectTwoBody)
	}
}

func newCurrentApplicationSkillsPostgresPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	const environment = "ELITEA_TEST_DATABASE_URL"
	databaseURL := os.Getenv(environment)
	if databaseURL == "" {
		t.Skipf("set %s to run the PostgreSQL service-integration test", environment)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	adminConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse %s: %v", environment, err)
	}
	adminConfig.MaxConns = 2
	adminPool, err := pgxpool.NewWithConfig(ctx, adminConfig)
	if err != nil {
		t.Fatalf("open PostgreSQL admin pool: %v", err)
	}
	if err := adminPool.Ping(ctx); err != nil {
		adminPool.Close()
		t.Fatalf("ping PostgreSQL: %v", err)
	}

	databaseName := fmt.Sprintf("elitea_application_skills_it_%d_%d", os.Getpid(), time.Now().UnixNano())
	quotedDatabase := pgx.Identifier{databaseName}.Sanitize()
	if _, err := adminPool.Exec(ctx, "CREATE DATABASE "+quotedDatabase); err != nil {
		adminPool.Close()
		t.Fatalf("create isolated PostgreSQL integration database: %v", err)
	}

	testConfig := adminConfig.Copy()
	testConfig.ConnConfig.Database = databaseName
	testConfig.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, testConfig)
	if err != nil {
		_, _ = adminPool.Exec(context.Background(), "DROP DATABASE "+quotedDatabase+" WITH (FORCE)")
		adminPool.Close()
		t.Fatalf("open isolated PostgreSQL integration database: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		_, _ = adminPool.Exec(context.Background(), "DROP DATABASE "+quotedDatabase+" WITH (FORCE)")
		adminPool.Close()
		t.Fatalf("ping isolated PostgreSQL integration database: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer dropCancel()
		if _, err := adminPool.Exec(
			dropCtx,
			"DROP DATABASE "+quotedDatabase+" WITH (FORCE)",
		); err != nil {
			t.Errorf("drop isolated PostgreSQL integration database: %v", err)
		}
		adminPool.Close()
	})
	return pool
}

func prepareCurrentApplicationSkillsProjects(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if _, err := pool.Exec(ctx, `
CREATE SCHEMA centry;
CREATE TABLE centry.project (id INTEGER PRIMARY KEY);
INSERT INTO centry.project (id) VALUES (1), (2);
CREATE SCHEMA p_1;
CREATE SCHEMA p_2;

CREATE TABLE p_1.skills (
    id INTEGER PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description VARCHAR(2304) NOT NULL
);
CREATE TABLE p_1.skill_versions (
    id INTEGER PRIMARY KEY,
    skill_id INTEGER NOT NULL,
    name VARCHAR(128) NOT NULL,
    meta JSONB DEFAULT '{}'::jsonb
);
CREATE TABLE p_1.entity_skill_mapping (
    id INTEGER PRIMARY KEY,
    entity_version_id INTEGER NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    skill_id INTEGER NOT NULL,
    skill_version_id INTEGER
);
INSERT INTO p_1.skills (id, name, description) VALUES
    (101, 'deploy', 'Deploy safely'),
    (102, 'review', 'Review changes'),
    (103, 'pipeline-only', 'Not an agent skill');
INSERT INTO p_1.skill_versions (id, skill_id, name, meta) VALUES
    (201, 101, 'release', '{"icon_meta":{"url":"/icons/deploy.svg","type":"image/svg+xml"}}');
INSERT INTO p_1.entity_skill_mapping (
    id, entity_version_id, entity_type, skill_id, skill_version_id
) VALUES
    (1, 301, 'agent', 101, 201),
    (2, 301, 'agent', 102, NULL),
    (3, 301, 'pipeline', 103, NULL),
    (4, 302, 'agent', 103, NULL);

CREATE TABLE p_2.skills (
    id INTEGER PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description VARCHAR(2304) NOT NULL
);
CREATE TABLE p_2.skill_versions (
    id INTEGER PRIMARY KEY,
    skill_id INTEGER NOT NULL,
    name VARCHAR(128) NOT NULL,
    meta JSONB DEFAULT '{}'::jsonb
);
CREATE TABLE p_2.entity_skill_mapping (
    id INTEGER PRIMARY KEY,
    entity_version_id INTEGER NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    skill_id INTEGER NOT NULL,
    skill_version_id INTEGER
);
INSERT INTO p_2.skills (id, name, description)
VALUES (101, 'private-project-skill', 'Tenant two only');
INSERT INTO p_2.skill_versions (id, skill_id, name, meta)
VALUES (201, 101, 'base', '{}');
INSERT INTO p_2.entity_skill_mapping (
    id, entity_version_id, entity_type, skill_id, skill_version_id
) VALUES (1, 301, 'agent', 101, 201);`); err != nil {
		t.Fatalf("prepare current application-skills projects: %v", err)
	}
}
