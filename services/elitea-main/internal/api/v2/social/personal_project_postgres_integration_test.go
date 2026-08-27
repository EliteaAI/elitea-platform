package social_test

// THE BUG, AT THE SURFACE THE SPA READS.
//
// `GET /social/author` answered `"personal_project_id": ""` for every account a
// fresh deployment created, and kept answering it. Nothing in this service
// created the `project_user_<uid>` project the resolver looks for, so the
// value could never change. apps/elitea-web reads "" as "no personal project
// yet": routes/-guards/indexRoute.ts redirects to `/onboarding`, and that
// screen polls THIS endpoint every five seconds waiting for a project nothing
// was going to provision. Every new user was stuck there.
//
// This test is written against the endpoint rather than against the ensurer, so
// it fails if the wiring is dropped — which is the half that was missing, not
// the algorithm. Remove `WithPersonalProjectEnsurer` from
// internal/api/router.go and the assertion below goes red.
//
// Requires a PostgreSQL service (ELITEA_TEST_DATABASE_URL).

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	v2secrets "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/secrets"
	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/social"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/personalproject"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/projectprovisioning"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/dbtest"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/migrate"
	platformmigrations "github.com/EliteaAI/elitea-platform/services/elitea-main/migrations"
)

const (
	personalProjectSocialURLEnv    = "ELITEA_TEST_DATABASE_URL"
	personalProjectSocialBootstrap = "../../../infra/db/migrations/001_initial.sql"
)

// personalProjectSocialTemplate names the template database the tests here
// copy. The provisioner applies the ledgered TENANT history, which
// internal/infra/db.RunMigrations (what the other integration tests in this
// package use) does not install — so this suite builds the same template
// internal/application/projectprovisioning's own suite does.
var personalProjectSocialTemplate string

func TestMain(m *testing.M) {
	databaseURL := personalProjectSocialDatabaseURL()
	if databaseURL == "" {
		os.Exit(m.Run())
	}

	bootstrap, err := os.ReadFile(personalProjectSocialBootstrap)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read bootstrap schema: %v\n", err)
		os.Exit(1)
	}

	ctx, cancel := dbtest.BuildContext(context.Background())
	adminPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open admin pool: %v\n", err)
		cancel()
		os.Exit(1)
	}
	templateName, err := dbtest.EnsureTemplate(ctx, adminPool, dbtest.Spec{
		Files:   platformmigrations.Files,
		Seed:    string(bootstrap),
		Tenants: []int64{1},
	})
	adminPool.Close()
	cancel()
	if err != nil {
		fmt.Fprintf(os.Stderr, "build personal project template: %v\n", err)
		os.Exit(1)
	}
	personalProjectSocialTemplate = templateName
	os.Exit(m.Run())
}

func personalProjectSocialDatabaseURL() string {
	databaseURL := os.Getenv(personalProjectSocialURLEnv)
	if databaseURL == "" && os.Getenv("ELITEA_TEST_USE_SERVICE_DATABASE_URL") == "1" {
		databaseURL = os.Getenv("DATABASE_URL")
	}
	return databaseURL
}

func TestGetAuthorProvisionsTheMissingPersonalProject(t *testing.T) {
	ctx := context.Background()
	pool := newPersonalProjectSocialPool(t)
	userID := seedAuthorUser(t, pool, "stuck-on-onboarding@autotest.local", "Newcomer")

	routes := handler.NewHandler(pool,
		handler.WithPersonalProjectEnsurer(newAuthorEnsurer(t, pool)),
	).Routes()

	author := func() struct {
		ID                string `json:"id"`
		PersonalProjectID string `json:"personal_project_id"`
	} {
		request := httptest.NewRequest(http.MethodGet, "/author/", nil)
		request = request.WithContext(auth.ContextWithUser(request.Context(),
			auth.User{ID: strconv.FormatInt(userID, 10), Email: "stuck-on-onboarding@autotest.local"}))
		recorder := httptest.NewRecorder()
		routes.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("GET /author/ status = %d (body %s)", recorder.Code, recorder.Body.String())
		}
		var decoded struct {
			ID                string `json:"id"`
			PersonalProjectID string `json:"personal_project_id"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("decode author response %s: %v", recorder.Body.String(), err)
		}
		return decoded
	}

	// The first read is the honest "" — provisioning has only just been asked
	// for. This is the state the onboarding screen is written against, and it
	// is asserted rather than skipped past: an implementation that blocked the
	// request until the tenant was built would hold a poll open for minutes.
	if first := author(); first.PersonalProjectID != "" {
		t.Fatalf("the first read already answered %q; the fixture is not a fresh account",
			first.PersonalProjectID)
	}

	// The read the SPA is waiting for. Before this change it never arrived.
	deadline := time.Now().Add(60 * time.Second)
	var resolved string
	for time.Now().Before(deadline) {
		if resolved = author().PersonalProjectID; resolved != "" {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if resolved == "" {
		t.Fatal("GET /social/author never reported a personal project: a new user stays on /onboarding forever")
	}

	// And it names the caller's OWN project — the resolver's first branch is
	// membership-checked precisely because this value is used as an
	// authorization scope (issue #166/#167).
	var name string
	var ownerID int64
	var created bool
	projectID, err := strconv.ParseInt(resolved, 10, 64)
	if err != nil {
		t.Fatalf("personal_project_id %q is not an id: %v", resolved, err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT name, owner_id, create_success FROM centry.project WHERE id = $1`, projectID,
	).Scan(&name, &ownerID, &created); err != nil {
		t.Fatalf("read the reported project %d: %v", projectID, err)
	}
	if want := personalproject.Name(userID); name != want {
		t.Fatalf("the reported project is named %q, want %q", name, want)
	}
	if ownerID != userID || !created {
		t.Fatalf("owner = %d (want %d), create_success = %v (want true)", ownerID, userID, created)
	}
}

// The endpoint must keep working when the composition could not build an
// ensurer — a pool-less deployment, which is the same gate the project-create
// route uses. The handler holds a nil ensurer and answers as it always did.
func TestGetAuthorWithoutAnEnsurerStillAnswers(t *testing.T) {
	pool := newPersonalProjectSocialPool(t)
	userID := seedAuthorUser(t, pool, "no-ensurer@autotest.local", "Plain")

	request := httptest.NewRequest(http.MethodGet, "/author/", nil)
	request = request.WithContext(auth.ContextWithUser(request.Context(),
		auth.User{ID: strconv.FormatInt(userID, 10), Email: "no-ensurer@autotest.local"}))
	recorder := httptest.NewRecorder()
	handler.NewHandler(pool).Routes().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", recorder.Code, recorder.Body.String())
	}
}

/* ── fixture ───────────────────────────────────────────────────────────── */

func newAuthorEnsurer(t *testing.T, pool *pgxpool.Pool) *personalproject.Ensurer {
	t.Helper()
	provisioner := projectprovisioning.New(
		pool,
		migrate.New(pool, platformmigrations.Files),
		nil,
		projectprovisioning.WithProjectVault(v2secrets.NewHandler(pool)),
	)
	ensurer, err := personalproject.NewEnsurer(pool, provisioner)
	if err != nil {
		t.Fatalf("build ensurer: %v", err)
	}
	return ensurer
}

func seedAuthorUser(t *testing.T, pool *pgxpool.Pool, email, name string) int64 {
	t.Helper()
	var userID int64
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO public.auth_core__user (email, name) VALUES ($1, $2) RETURNING id`,
		email, name,
	).Scan(&userID); err != nil {
		t.Fatalf("seed user %s: %v", email, err)
	}
	return userID
}

// newPersonalProjectSocialPool builds an isolated database holding the
// bootstrap schema and the full ledgered corpus — the provisioner applies the
// tenant history, so a hand-built fixture could not run it.
func newPersonalProjectSocialPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := personalProjectSocialDatabaseURL()
	if databaseURL == "" {
		t.Skipf("set %s to run the personal project author-endpoint test", personalProjectSocialURLEnv)
	}
	if personalProjectSocialTemplate == "" {
		t.Fatalf("TestMain did not build the personal project template")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	adminPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open admin pool: %v", err)
	}
	defer adminPool.Close()

	databaseName := fmt.Sprintf("elitea_social_pp_%d_%d", os.Getpid(), time.Now().UnixNano())
	if err := dbtest.CreateFromTemplate(ctx, adminPool, personalProjectSocialTemplate, databaseName); err != nil {
		t.Fatalf("create isolated database: %v", err)
	}

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse %s: %v", personalProjectSocialURLEnv, err)
	}
	config.ConnConfig.Database = databaseName
	config.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatalf("open isolated pool: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 120*time.Second)
		defer dropCancel()
		dropPool, dropErr := pgxpool.New(dropCtx, databaseURL)
		if dropErr != nil {
			return
		}
		defer dropPool.Close()
		_, _ = dropPool.Exec(dropCtx,
			"DROP DATABASE IF EXISTS "+pgx.Identifier{databaseName}.Sanitize()+" WITH (FORCE)")
	})
	return pool
}
