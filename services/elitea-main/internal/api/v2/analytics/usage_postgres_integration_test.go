package analytics_test

// The project analytics reads, against the REAL gateway schema.
//
// A 200 proves nothing here. This endpoint has shipped a 200 for its whole life
// while every query behind it raised undefined_table (#303), and the response
// was byte-identical for a busy project and a nonexistent one. So every case
// below asserts a FIGURE, and each figure is picked to be one the handler could
// not produce by accident:
//
//   - rows are planted for a NEIGHBOURING project and OUTSIDE the window, and
//     must be absent from every total — a query missing either predicate
//     produces a bigger, plausible number rather than an error;
//   - a user holding TWO roles in the project must count ONCE in the adoption
//     denominator, because membership is expressed as role grants;
//   - a request that resolved no model is counted in the totals and absent from
//     the per-model split, which is the one place those two disagree on purpose;
//   - the figures with no producer are asserted ABSENT, not zero.
//
// The schema comes from infradb.GatewayMigrationSQL() — the files production
// applies — so a column renamed there and not here fails at setup rather than
// passing against a hand-copied DDL.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/analytics"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
)

const (
	usageProjectID = 41
	usageOtherID   = 42
)

// usageNow pins the clock the default window is measured back from, so a run
// near midnight cannot land a fixture outside the window it then reads.
var usageNow = time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)

func usageRouter(pool *pgxpool.Pool) chi.Router {
	h := handler.NewHandler(repos.NewAnalyticsRepo(pool)).
		WithClock(func() time.Time { return usageNow })
	router := chi.NewRouter()
	router.Get("/analytics/prompt_lib/{projectID}", h.Usage)
	router.Get("/analytics_users/prompt_lib/{projectID}", h.Users)
	router.Get("/analytics_agents/prompt_lib/{projectID}", h.Agents)
	router.Get("/analytics_tools/prompt_lib/{projectID}", h.Tools)
	return router
}

// plantRequest writes one row of the gateway's request log.
//
// userID 0 means NULL — 0099 stores NULL when no member resolved, and "no
// member" and "member 0" are different claims.
func plantRequest(
	t *testing.T, pool *pgxpool.Pool,
	projectID, userID int, at time.Time, model, provider string,
	promptTokens, completionTokens int64,
) {
	t.Helper()
	var user any
	if userID != 0 {
		user = userID
	}
	_, err := pool.Exec(context.Background(), `
INSERT INTO gateway.llm_request_logs
    (project_id, user_id, occurred_at, route, method, status,
     duration_ms, provider, model, streaming, prompt_tokens, completion_tokens)
VALUES ($1, $2, $3, '/llm/v1/chat/completions', 'POST', 200, 120, $4, $5, false, $6, $7)`,
		projectID, user, at, provider, model, promptTokens, completionTokens)
	if err != nil {
		t.Fatalf("plant request log row: %v", err)
	}
}

// plantMembership creates the identity tables this service does not own and
// grants a role, so the adoption denominator has something to count.
func plantMembership(t *testing.T, pool *pgxpool.Pool, projectID int, grants map[int][]string) {
	t.Helper()
	ctx := context.Background()
	for _, ddl := range []string{
		`CREATE TABLE IF NOT EXISTS public.auth_core__user (
			id SERIAL PRIMARY KEY, email TEXT, name TEXT)`,
		`CREATE TABLE IF NOT EXISTS public.auth_core__project_role (
			id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL, name TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS public.auth_core__user_role (
			user_id INTEGER NOT NULL, role_id INTEGER NOT NULL)`,
	} {
		if _, err := pool.Exec(ctx, ddl); err != nil {
			t.Fatalf("create identity table: %v", err)
		}
	}
	for userID, roles := range grants {
		if _, err := pool.Exec(ctx, `
INSERT INTO public.auth_core__user (id, email, name) VALUES ($1, $2, $3)
ON CONFLICT (id) DO NOTHING`,
			userID, fmt.Sprintf("user%d@example.com", userID), fmt.Sprintf("User %d", userID)); err != nil {
			t.Fatalf("plant user: %v", err)
		}
		for _, role := range roles {
			var roleID int
			if err := pool.QueryRow(ctx, `
INSERT INTO public.auth_core__project_role (project_id, name) VALUES ($1, $2) RETURNING id`,
				projectID, role).Scan(&roleID); err != nil {
				t.Fatalf("plant role: %v", err)
			}
			if _, err := pool.Exec(ctx, `
INSERT INTO public.auth_core__user_role (user_id, role_id) VALUES ($1, $2)`,
				userID, roleID); err != nil {
				t.Fatalf("plant grant: %v", err)
			}
		}
	}
}

func usageGet(t *testing.T, router chi.Router, target string) (int, map[string]any) {
	t.Helper()
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
	decoder := json.NewDecoder(recorder.Body)
	decoder.UseNumber()
	payload := map[string]any{}
	if err := decoder.Decode(&payload); err != nil {
		t.Fatalf("decode (status %d): %v", recorder.Code, err)
	}
	return recorder.Code, payload
}

func wantNumber(t *testing.T, where map[string]any, field, want string) {
	t.Helper()
	number, ok := where[field].(json.Number)
	if !ok {
		t.Fatalf("%s = %#v, want a JSON number", field, where[field])
	}
	if number.String() != want {
		t.Fatalf("%s = %s, want %s", field, number, want)
	}
}

func newUsageEnvironment(t *testing.T) (*pgxpool.Pool, chi.Router) {
	t.Helper()
	pool := newCostsPool(t)
	return pool, usageRouter(pool)
}

/* ── the overview ──────────────────────────────────────────────────────── */

func TestUsageReportsWhatTheGatewayLogged(t *testing.T) {
	pool, router := newUsageEnvironment(t)

	inWindow := usageNow.Add(-24 * time.Hour)
	plantRequest(t, pool, usageProjectID, 7, inWindow, "gpt-4o", "openai", 100, 20)
	plantRequest(t, pool, usageProjectID, 7, inWindow, "gpt-4o", "openai", 50, 10)
	plantRequest(t, pool, usageProjectID, 8, inWindow, "claude-opus-5", "anthropic", 300, 40)

	// The three rows that must NOT be counted, each defeating a different
	// predicate. A query missing one of them still answers 200 with a larger
	// number, which is why they are here and not in a separate case.
	plantRequest(t, pool, usageOtherID, 7, inWindow, "gpt-4o", "openai", 999, 999)
	plantRequest(t, pool, usageProjectID, 7, usageNow.Add(-40*24*time.Hour), "gpt-4o", "openai", 999, 999)
	plantRequest(t, pool, usageProjectID, 7, usageNow.Add(time.Hour), "gpt-4o", "openai", 999, 999)

	status, body := usageGet(t, router, fmt.Sprintf("/analytics/prompt_lib/%d", usageProjectID))
	if status != http.StatusOK {
		t.Fatalf("status %d: %v", status, body)
	}

	kpis, ok := body["kpis"].(map[string]any)
	if !ok {
		t.Fatalf("no kpis: %v", body)
	}
	wantNumber(t, kpis, "llm_calls", "3")
	wantNumber(t, kpis, "total_tokens", "520") // 120 + 60 + 340
	wantNumber(t, kpis, "ai_active_users", "2")

	// Two (provider, model) pairs, busiest first.
	models, ok := body["models"].([]any)
	if !ok || len(models) != 2 {
		t.Fatalf("models = %#v, want 2 rows", body["models"])
	}
	first, _ := models[0].(map[string]any)
	if first["model"] != "gpt-4o" || first["provider"] != "openai" {
		t.Fatalf("busiest model row = %v", first)
	}
	wantNumber(t, first, "run_count", "2")
	wantNumber(t, first, "prompt_tokens", "150")
	wantNumber(t, first, "completion_tokens", "30")

	// Money is /analytics_costs' to report, and a per-model cost has no
	// producer at all. Neither may appear here as a zero.
	if _, present := first["total_cost"]; present {
		t.Errorf("a per-model total_cost appeared: %v", first)
	}
	for _, absent := range []string{"total_cost", "tool_runs", "chat_msgs", "agent_runs", "unique_users"} {
		if v, present := kpis[absent]; present {
			t.Errorf("kpis.%s = %v, but nothing in this platform produces it", absent, v)
		}
	}
}

// A request that never resolved a model is real traffic and is counted, but it
// is not a model's usage. The two must disagree in exactly this one way.
func TestUnresolvedModelCountsInTotalsAndNotInTheModelSplit(t *testing.T) {
	pool, router := newUsageEnvironment(t)

	at := usageNow.Add(-2 * time.Hour)
	plantRequest(t, pool, usageProjectID, 7, at, "gpt-4o", "openai", 10, 10)
	plantRequest(t, pool, usageProjectID, 7, at, "", "", 0, 0) // refused before model resolution

	_, body := usageGet(t, router, fmt.Sprintf("/analytics/prompt_lib/%d", usageProjectID))
	kpis, _ := body["kpis"].(map[string]any)

	wantNumber(t, kpis, "llm_calls", "2")
	models, _ := body["models"].([]any)
	if len(models) != 1 {
		t.Fatalf("models = %#v, want exactly the one resolved model", body["models"])
	}
}

/* ── adoption ──────────────────────────────────────────────────────────── */

// The denominator counts MEMBERS, not role grants. One member holding two roles
// is one member; counting grants inflates the denominator and understates
// adoption, and the result is a plausible smaller percentage rather than an
// error.
func TestAdoptionRateCountsAMemberOnceWhateverTheirRoles(t *testing.T) {
	pool, router := newUsageEnvironment(t)

	plantMembership(t, pool, usageProjectID, map[int][]string{
		7:  {"admin", "editor"}, // two grants, one member
		8:  {"viewer"},
		9:  {"viewer"},
		10: {"viewer"},
	})
	plantRequest(t, pool, usageProjectID, 7, usageNow.Add(-time.Hour), "gpt-4o", "openai", 1, 1)

	_, body := usageGet(t, router, fmt.Sprintf("/analytics/prompt_lib/%d", usageProjectID))
	kpis, _ := body["kpis"].(map[string]any)

	wantNumber(t, kpis, "total_project_users", "4")
	wantNumber(t, kpis, "ai_active_users", "1")
	wantNumber(t, kpis, "adoption_rate", "25")
}

// The Users tab's cap must be VISIBLE. The client paginates and searches
// client-side over the array it receives, so a silent cut would present the
// busiest N callers as the whole membership, with a working pagination footer
// and a count label, and nothing anywhere able to tell the difference.
func TestUserListReportsWhenItWasCut(t *testing.T) {
	pool, router := newUsageEnvironment(t)

	at := usageNow.Add(-time.Hour)
	plantRequest(t, pool, usageProjectID, 7, at, "gpt-4o", "openai", 1, 1)

	_, body := usageGet(t, router, fmt.Sprintf("/analytics_users/prompt_lib/%d", usageProjectID))
	// Present and false, not absent: an absent flag reads as false and is
	// indistinguishable from a server that does not send one.
	if truncated, ok := body["truncated"].(bool); !ok || truncated {
		t.Fatalf("truncated = %#v, want false for a one-row list", body["truncated"])
	}
}

// A rate whose numerator is drawn from a different population than its
// denominator is not a rate. Callers include identities the membership table
// does not contain — a removed member, a global administrator, a service token
// — so dividing every caller by the member count reports above 100% as a matter
// of course. Measured before the fix: 3 callers, 1 member, "adoption_rate: 300"
// and a tile reading "3 of 1, ↑300% adoption".
func TestAdoptionRateCountsOnlyMembersInItsNumerator(t *testing.T) {
	pool, router := newUsageEnvironment(t)

	plantMembership(t, pool, usageProjectID, map[int][]string{7: {"admin"}})
	at := usageNow.Add(-time.Hour)
	plantRequest(t, pool, usageProjectID, 7, at, "gpt-4o", "openai", 1, 1)  // a member
	plantRequest(t, pool, usageProjectID, 90, at, "gpt-4o", "openai", 1, 1) // not a member
	plantRequest(t, pool, usageProjectID, 91, at, "gpt-4o", "openai", 1, 1) // not a member

	_, body := usageGet(t, router, fmt.Sprintf("/analytics/prompt_lib/%d", usageProjectID))
	kpis, _ := body["kpis"].(map[string]any)

	// Every caller is still reported — it is a true figure about real usage.
	wantNumber(t, kpis, "ai_active_users", "3")
	wantNumber(t, kpis, "total_project_users", "1")
	// The intersection, and therefore a rate that cannot exceed 100%.
	wantNumber(t, kpis, "active_project_members", "1")
	wantNumber(t, kpis, "adoption_rate", "100")
}

// The membership tables and `public.auth_core__user` are created by DIFFERENT
// corpora, so a database can hold the role tables and not the user table.
//
// This is the state that cost a figure. `userIdentities` tolerated the 42P01
// from the missing user table — but every statement in GetUsageSummary runs in
// ONE transaction, and a failed statement aborts it: the adoption probe that
// ran next answered 25P02, reported "absent", and a project with a populated
// membership table lost its denominator and its rate entirely.
//
// TestMissingMembershipTablesDoNotFailTheRead cannot catch this: it has none of
// the three tables, so the denominator would be absent either way.
func TestMembershipSurvivesAnAbsentUserTable(t *testing.T) {
	pool, router := newUsageEnvironment(t)

	plantMembership(t, pool, usageProjectID, map[int][]string{7: {"admin"}, 8: {"viewer"}, 9: {"viewer"}})
	// The user table goes, the role tables stay.
	if _, err := pool.Exec(context.Background(), "DROP TABLE public.auth_core__user"); err != nil {
		t.Fatalf("drop user table: %v", err)
	}
	plantRequest(t, pool, usageProjectID, 7, usageNow.Add(-time.Hour), "gpt-4o", "openai", 5, 5)

	status, body := usageGet(t, router, fmt.Sprintf("/analytics/prompt_lib/%d", usageProjectID))
	if status != http.StatusOK {
		t.Fatalf("status %d: %v", status, body)
	}
	kpis, _ := body["kpis"].(map[string]any)

	// The denominator is measurable and must be measured: only the DISPLAY
	// NAMES were unavailable.
	wantNumber(t, kpis, "total_project_users", "3")
	wantNumber(t, kpis, "active_project_members", "1")
	wantNumber(t, kpis, "adoption_rate", "33.3")

	// And the statement after the failure still ran — the leaderboard is
	// present, just without emails.
	top, ok := body["top_ai_users"].([]any)
	if !ok || len(top) != 1 {
		t.Fatalf("top_ai_users = %#v, want the row without its email", body["top_ai_users"])
	}
	if row, _ := top[0].(map[string]any); row["email"] != "" {
		t.Fatalf("email = %v, want empty", row["email"])
	}
}

// The identity tables belong to another corpus and a Go-bootstrapped database
// has neither. Their absence must cost the response its DENOMINATOR and
// nothing else — not the whole read.
func TestMissingMembershipTablesDoNotFailTheRead(t *testing.T) {
	pool, router := newUsageEnvironment(t)

	plantRequest(t, pool, usageProjectID, 7, usageNow.Add(-time.Hour), "gpt-4o", "openai", 5, 5)

	status, body := usageGet(t, router, fmt.Sprintf("/analytics/prompt_lib/%d", usageProjectID))
	if status != http.StatusOK {
		t.Fatalf("status %d with no identity tables: %v", status, body)
	}
	kpis, _ := body["kpis"].(map[string]any)
	wantNumber(t, kpis, "llm_calls", "1")
	for _, absent := range []string{"total_project_users", "adoption_rate", "active_project_members"} {
		if v, present := kpis[absent]; present {
			t.Errorf("kpis.%s = %v with no membership source", absent, v)
		}
	}
}

/* ── the users tab ─────────────────────────────────────────────────────── */

func TestUserActivityRanksByCallsAndResolvesIdentity(t *testing.T) {
	pool, router := newUsageEnvironment(t)

	plantMembership(t, pool, usageProjectID, map[int][]string{7: {"admin"}, 8: {"viewer"}})
	at := usageNow.Add(-3 * time.Hour)
	plantRequest(t, pool, usageProjectID, 8, at, "gpt-4o", "openai", 10, 5)
	plantRequest(t, pool, usageProjectID, 7, at, "gpt-4o", "openai", 10, 5)
	plantRequest(t, pool, usageProjectID, 7, at.Add(time.Minute), "gpt-4o", "openai", 10, 5)
	// A request with no resolved member. It is real traffic, but "no member" is
	// not a user to put on a leaderboard.
	plantRequest(t, pool, usageProjectID, 0, at, "gpt-4o", "openai", 99, 99)

	status, body := usageGet(t, router, fmt.Sprintf("/analytics_users/prompt_lib/%d", usageProjectID))
	if status != http.StatusOK {
		t.Fatalf("status %d: %v", status, body)
	}
	items, ok := body["items"].([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("items = %#v, want 2 users", body["items"])
	}
	top, _ := items[0].(map[string]any)
	if top["user_id"] != "7" {
		t.Fatalf("leaderboard is not ordered by calls: %v", items)
	}
	wantNumber(t, top, "run_count", "2")
	wantNumber(t, top, "total_tokens", "30")
	if top["email"] != "user7@example.com" {
		t.Fatalf("identity not resolved: %v", top)
	}
}

// Same read with no identity tables: the numbers survive, only the decoration
// is lost. Failing the whole read because a display name is unavailable is the
// defect this asserts against.
func TestUserActivitySurvivesMissingIdentityTables(t *testing.T) {
	pool, router := newUsageEnvironment(t)

	plantRequest(t, pool, usageProjectID, 7, usageNow.Add(-time.Hour), "gpt-4o", "openai", 4, 4)

	status, body := usageGet(t, router, fmt.Sprintf("/analytics_users/prompt_lib/%d", usageProjectID))
	if status != http.StatusOK {
		t.Fatalf("status %d with no identity tables: %v", status, body)
	}
	items, _ := body["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("items = %#v, want the row without its email", body["items"])
	}
	row, _ := items[0].(map[string]any)
	wantNumber(t, row, "run_count", "1")
	if row["email"] != "" {
		t.Fatalf("email = %v, want empty", row["email"])
	}
}

/* ── what is still refused ─────────────────────────────────────────────── */

// Agents and tools have no producer, and that must arrive as a FINAL answer.
// 500 invites every 5xx-retrying client to ask again for something the server
// has already decided it cannot give.
func TestAgentsAndToolsRefuseFinally(t *testing.T) {
	pool, router := newUsageEnvironment(t)
	plantRequest(t, pool, usageProjectID, 7, usageNow.Add(-time.Hour), "gpt-4o", "openai", 1, 1)

	for _, path := range []string{"analytics_agents", "analytics_tools"} {
		status, body := usageGet(t, router, fmt.Sprintf("/%s/prompt_lib/%d", path, usageProjectID))
		if status != http.StatusNotImplemented {
			t.Errorf("%s answered %d, want 501", path, status)
		}
		if body["code"] != "no_data_source" {
			t.Errorf("%s carries code %v, want no_data_source", path, body["code"])
		}
		if _, present := body["items"]; present {
			t.Errorf("%s presents its refusal as data: %v", path, body)
		}
	}
}

// A project id that cannot name a project is the CALLER's mistake, and must be
// answered as one. It reached writeRepoFailure as a plain error first, matched
// no branch, and came back `500 {"code":"query_failed"}` — the server taking
// the blame for a value it was handed, on a request no retry can fix.
// /analytics_costs has always answered 400 for the same input.
func TestMalformedProjectIDIsABadRequest(t *testing.T) {
	_, router := newUsageEnvironment(t)

	for _, target := range []string{"/analytics/prompt_lib/0", "/analytics_users/prompt_lib/0"} {
		status, body := usageGet(t, router, target)
		if status != http.StatusBadRequest {
			t.Errorf("%s answered %d, want 400 (body %v)", target, status, body)
		}
		if body["code"] != "bad_project_id" {
			t.Errorf("%s carries code %v, want bad_project_id", target, body["code"])
		}
	}
}
