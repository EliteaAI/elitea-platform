package gateway_test

// #322 acceptance: PUT /admin/gateway/budget-alerts persists, and what it
// persists is what the gateway reads.
//
// The old store passed every test it had — defaults, partial update, bounds —
// while writing to a process-local struct. So none of the assertions here are
// about the response body alone. Each one either re-reads through a SECOND
// store built over the same database (the restart / second-replica case) or
// reads the row through the gateway's own snapshot expression.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/gateway"
	infradb "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db"
)

func newAlertPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	const environment = "ELITEA_TEST_DATABASE_URL"
	databaseURL := os.Getenv(environment)
	if databaseURL == "" {
		t.Skipf("set %s to run the PostgreSQL service-integration test", environment)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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

	databaseName := fmt.Sprintf("elitea_alerts_it_%d_%d", os.Getpid(), time.Now().UnixNano())
	quoted := pgx.Identifier{databaseName}.Sanitize()
	if _, err := adminPool.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		adminPool.Close()
		t.Fatalf("create isolated database: %v", err)
	}

	testConfig := adminConfig.Copy()
	testConfig.ConnConfig.Database = databaseName
	testConfig.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, testConfig)
	if err != nil {
		adminPool.Close()
		t.Fatalf("open isolated database: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 120*time.Second)
		defer dropCancel()
		if _, err := adminPool.Exec(dropCtx, "DROP DATABASE "+quoted+" WITH (FORCE)"); err != nil {
			t.Errorf("drop isolated database: %v", err)
		}
		adminPool.Close()
	})

	// The REAL migration corpus, applied to an EMPTY database. A seeded or
	// dump-loaded database would already hold gateway.governance_config and
	// would hide a migration that never creates or seeds anything.
	gatewaySQL, err := infradb.GatewayMigrationSQL()
	if err != nil {
		t.Fatalf("load gateway migrations: %v", err)
	}
	if _, err := pool.Exec(ctx, gatewaySQL); err != nil {
		t.Fatalf("apply gateway migrations: %v", err)
	}
	return pool
}

func alertDo(t *testing.T, pool *pgxpool.Pool, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	h := gateway.NewBudgetAlertHandler(gateway.NewBudgetAlertStore(pool))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(method, "/budget-alerts", strings.NewReader(body))
	h.Routes().ServeHTTP(rr, req)
	return rr
}

func decodeAlertConfig(t *testing.T, rr *httptest.ResponseRecorder) gateway.BudgetAlertConfig {
	t.Helper()
	var cfg gateway.BudgetAlertConfig
	if err := json.Unmarshal(rr.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("decode %q: %v", rr.Body.String(), err)
	}
	return cfg
}

// TestMigrationSeedsTheGlobalRow: a GET before any PUT answers with the same
// values the old in-process store returned, so upgrading changes nothing an
// operator can see except that the value now survives.
func TestMigrationSeedsTheGlobalRow(t *testing.T) {
	pool := newAlertPool(t)

	rr := alertDo(t, pool, http.MethodGet, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rr.Code, rr.Body.String())
	}
	cfg := decodeAlertConfig(t, rr)
	if !cfg.Enabled || cfg.ThresholdPct != gateway.DefaultSoftAlertThresholdPct {
		t.Fatalf("seeded config = %+v, want enabled at %d", cfg, gateway.DefaultSoftAlertThresholdPct)
	}
}

// TestUpdateSurvivesARestart is the defect. The second store is a fresh
// instance over the same database — the restart, and equally the second
// elitea-main replica that used to answer with its own divergent value.
func TestUpdateSurvivesARestart(t *testing.T) {
	pool := newAlertPool(t)

	rr := alertDo(t, pool, http.MethodPut, `{"enabled":false,"threshold_pct":55}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want 200 (body %s)", rr.Code, rr.Body.String())
	}
	if cfg := decodeAlertConfig(t, rr); cfg.Enabled || cfg.ThresholdPct != 55 {
		t.Fatalf("PUT returned %+v, want {false 55}", cfg)
	}

	// A brand-new store, as a restarted or second replica would build.
	fresh := gateway.NewBudgetAlertStore(pool)
	cfg, err := fresh.Get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Enabled {
		t.Fatal("a restarted replica reports alerts enabled; the operator's change was lost")
	}
	if cfg.ThresholdPct != 55 {
		t.Fatalf("threshold = %d, want the saved 55", cfg.ThresholdPct)
	}
}

// TestUpdateIsAPartialPatch: two operators changing different fields must not
// lose each other's write. The old read-modify-write in memory did not have to
// get this right because it never persisted.
func TestUpdateIsAPartialPatch(t *testing.T) {
	pool := newAlertPool(t)

	if rr := alertDo(t, pool, http.MethodPut, `{"threshold_pct":90}`); rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	rr := alertDo(t, pool, http.MethodPut, `{"enabled":false}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	cfg := decodeAlertConfig(t, rr)
	if cfg.ThresholdPct != 90 {
		t.Fatalf("threshold = %d, want the 90 the first write saved", cfg.ThresholdPct)
	}
	if cfg.Enabled {
		t.Fatal("the second write did not take effect")
	}
}

// TestTheGatewaySeesTheSameValue closes the loop #322's second half is about:
// the config had no reader at all. This runs the gateway's OWN snapshot
// expression — the subquery from failmode/store.go globalAlertConfigSQL — over
// the row this API wrote, so a divergence in the three key columns
// (section/type/name) fails here rather than in production.
func TestTheGatewaySeesTheSameValue(t *testing.T) {
	pool := newAlertPool(t)

	if rr := alertDo(t, pool, http.MethodPut, `{"enabled":false,"threshold_pct":42}`); rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}

	// Transcribed from services/elitea-llm-gateway/internal/failmode/store.go.
	// The gateway is outside go.work, so this cannot import the constant; the
	// column names and the three key values are the contract between them.
	const gatewayRead = `SELECT
		NOT COALESCE(ga.alerts_enabled, true),
		COALESCE(ga.threshold_pct, 80)
	FROM (
		SELECT (data->>'enabled')::boolean        AS alerts_enabled,
		       (data->>'threshold_pct')::smallint AS threshold_pct
		FROM gateway.governance_config
		WHERE section = 'governance' AND type = 'budget_alert' AND name = 'global'
		  AND enabled
	) ga`

	var alertsDisabled bool
	var thresholdPct int
	if err := pool.QueryRow(context.Background(), gatewayRead).Scan(&alertsDisabled, &thresholdPct); err != nil {
		t.Fatalf("the gateway's snapshot subquery found no row for the config this API wrote: %v", err)
	}
	if !alertsDisabled {
		t.Fatal("the gateway would still emit soft alerts after an operator turned them off")
	}
	if thresholdPct != 42 {
		t.Fatalf("the gateway would use threshold %d, not the saved 42", thresholdPct)
	}
}

// TestTheGlobalThresholdReachesAProjectWithoutItsOwn is the half that migration
// 0084's DROP NOT NULL exists for. Under 0067 soft_alert_pct was NOT NULL
// DEFAULT 80, so "a project without its own threshold" was unrepresentable and
// the documented global default could never apply to anything.
func TestTheGlobalThresholdReachesAProjectWithoutItsOwn(t *testing.T) {
	pool := newAlertPool(t)
	ctx := context.Background()

	if rr := alertDo(t, pool, http.MethodPut, `{"threshold_pct":65}`); rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}

	// A project that authored a limit but no threshold.
	if _, err := pool.Exec(ctx, `
INSERT INTO gateway.project_budget (project_id, hard_limit_usd, is_unlimited, enabled, soft_alert_pct)
VALUES (901, 100, false, true, NULL)`); err != nil {
		t.Fatalf("a project budget with no authored threshold could not be stored: %v", err)
	}
	// ...and one that did author one.
	if _, err := pool.Exec(ctx, `
INSERT INTO gateway.project_budget (project_id, hard_limit_usd, is_unlimited, enabled, soft_alert_pct)
VALUES (902, 100, false, true, 95)`); err != nil {
		t.Fatal(err)
	}

	const resolve = `SELECT COALESCE(pb.soft_alert_pct, ga.threshold_pct, 80)
		FROM gateway.project_budget pb
		LEFT JOIN (
			SELECT (data->>'threshold_pct')::smallint AS threshold_pct
			FROM gateway.governance_config
			WHERE section = 'governance' AND type = 'budget_alert' AND name = 'global'
			  AND enabled
		) ga ON true
		WHERE pb.project_id = $1`

	var inherited int
	if err := pool.QueryRow(ctx, resolve, 901).Scan(&inherited); err != nil {
		t.Fatal(err)
	}
	if inherited != 65 {
		t.Fatalf("a project with no authored threshold resolved to %d, want the global 65", inherited)
	}

	// The negative control: an authored threshold is NOT overridden by the
	// global default. Without this, a resolver that ignored the column entirely
	// would pass the test above.
	var authored int
	if err := pool.QueryRow(ctx, resolve, 902).Scan(&authored); err != nil {
		t.Fatal(err)
	}
	if authored != 95 {
		t.Fatalf("an authored threshold resolved to %d, want the project's own 95", authored)
	}
}
