package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/migrate"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/migrations"
)

// The credential screen's own request sequence, through the real router, the
// real resolver and a real database (#496).
//
// # WHY THIS EXISTS BESIDE THE ROUTE TESTS
//
// router_project_surface_gates_test.go proves each route refuses and admits
// against a FAKE resolver. That answers "does the gate run", and it cannot
// answer "does the screen still work". Those are different questions, and #128
// is the local record of a surface that answered 200 on every route and still
// had no behaviour behind it.
//
// This file asks the second question the only way that settles it: it seeds the
// permissions the end-to-end stack seeds, resolves them with
// legacyrbac.PostgresResolver against PostgreSQL, and issues the exact requests
// the AI-configuration page issues, in the order it issues them.
//
// # THE SEED IS READ, NOT COPIED
//
// The permission list comes from apps/elitea-web/scripts/e2e-stack.sh at run
// time, through the same parser e2e_seed_grant_parity_test.go uses. So this file
// measures the seed the journeys really run with. Remove a string from that
// script and the request it serves fails HERE, with the request named — which is
// what happened while this change was being made: the seed listed two of the
// five configuration strings, because until the gate landed the routes checked
// nothing.
//
// # BOTH DIRECTIONS
//
// The same sequence is issued for a project the caller is not a member of. Every
// request must be refused. Without that half, a router that admitted everyone
// would pass the whole file.

const credentialJourneyDatabaseURL = "ELITEA_TEST_DATABASE_URL"

const credentialJourneyDeadline = 120 * time.Second

// The caller: a member of project 1 and of no other project.
const credentialJourneyUserID = 4964

func TestTheCredentialScreenWorksForASeededMemberAndForNoOtherProject(t *testing.T) {
	pool := newCredentialJourneyPool(t)
	seedCredentialJourneyMember(t, pool)

	// All three #496 surfaces are composed, so one live-resolver run covers
	// them together. The webhook repository and the event source answer for ANY
	// project id, so a refusal below can only have come from the gate.
	source := newEventSource()
	router := NewRouter(RouterConfig{
		Pool:          pool,
		AuthValidator: apimw.TokenValidator(credentialJourneyValidator{}),
		WebhookRepo:   emptyWebhookRepo{},
		EventSource:   source,
	})

	// ── the catalogue ──────────────────────────────────────────────────────
	// The type picker's tiles. It names no project and carries no gate, so it
	// is also the control: if this one failed, every later refusal would be
	// meaningless.
	if status, _ := serveJourney(t, router, http.MethodGet,
		"/api/v2/configurations/available/", nil); status != http.StatusOK {
		t.Fatalf("the credential type catalogue answered %d; the page cannot render its tiles", status)
	}

	// ── the list, before the write ─────────────────────────────────────────
	// GET /configurations/configurations/{projectID}?section=… is what the
	// AI-configuration page reads on load, one request per section.
	const listPath = "/api/v2/configurations/configurations/1?section=ai_credentials"
	if status, _ := serveJourney(t, router, http.MethodGet, listPath, nil); status != http.StatusOK {
		t.Fatalf("the credential list answered %d for a seeded member.\n"+
			"  The page renders an empty screen. Check that the e2e seed grants "+
			"configurations.configurations.list to project 1.", status)
	}

	// ── the write ──────────────────────────────────────────────────────────
	created := map[string]any{}
	status, body := serveJourney(t, router, http.MethodPost,
		"/api/v2/configurations/configurations/1", map[string]any{
			"elitea_title": "journey-credential",
			"label":        "journey-credential",
			"type":         "open_ai",
			"data":         map[string]any{"api_key": "sk-journey", "api_base": "https://api.openai.com/v1"},
		})
	if status != http.StatusCreated {
		t.Fatalf("the credential save answered %d, want 201. Body: %s", status, body)
	}
	if err := json.Unmarshal([]byte(body), &created); err != nil {
		t.Fatalf("decode the created credential: %v", err)
	}
	configurationID := fmt.Sprintf("%v", created["id"])

	// The write stored the api_key VERBATIM, and that is the finding this whole
	// change is about rather than an assertion about the journey. The reference
	// converts a password field into a `{{secret.NAME}}` reference before the
	// INSERT; this path has no such step, so the row holds the provider key in
	// plain text and any caller who could read the row read the key.
	if data, ok := created["data"].(map[string]any); !ok || data["api_key"] != "sk-journey" {
		t.Fatalf("the created credential's data = %v; this test asserts the platform's real "+
			"storage shape, which is what makes the read gate load-bearing", created["data"])
	}

	// ── the detail read the edit dialog makes ──────────────────────────────
	detailPath := "/api/v2/configurations/configuration/1/" + configurationID
	if status, _ := serveJourney(t, router, http.MethodGet, detailPath, nil); status != http.StatusOK {
		t.Fatalf("the credential detail read answered %d; the edit dialog opens empty", status)
	}

	// ── the list again, and the model catalogue beside it ──────────────────
	if status, listBody := serveJourney(t, router, http.MethodGet, listPath, nil); status != http.StatusOK {
		t.Fatalf("the credential list answered %d after the write", status)
	} else if !bytes.Contains([]byte(listBody), []byte("journey-credential")) {
		t.Fatalf("the saved credential is not in the list the page reads. Body: %s", listBody)
	}
	// GET /configurations/models/{projectID} is the chat model picker's read and
	// the tokens page's read. It takes the same list permission.
	if status, _ := serveJourney(t, router, http.MethodGet,
		"/api/v2/configurations/models/1", nil); status != http.StatusOK {
		t.Fatalf("the model catalogue answered %d; the chat model picker is empty", status)
	}

	// ── the delete ─────────────────────────────────────────────────────────
	if status, _ := serveJourney(t, router, http.MethodDelete, detailPath, nil); status != http.StatusNoContent {
		t.Fatalf("the credential delete answered %d, want 204", status)
	}

	// ── the other two surfaces, for the caller's own project ───────────────
	//
	// The webhook listing takes the same `configurations.configurations.list`
	// the credential list takes, and the seed grants it. The project stream
	// takes `models.project_context.view`, which the seed grants as well.
	if status, _ := serveJourney(t, router, http.MethodGet,
		"/api/v2/webhooks/prompt_lib/1/", nil); status != http.StatusOK {
		t.Fatalf("the webhook listing answered %d for a seeded member", status)
	}
	if status, _ := serveJourney(t, router, http.MethodGet,
		"/api/v2/events/prompt_lib/1/", nil); status != http.StatusOK {
		t.Fatalf("the project event stream answered %d for a seeded member", status)
	}
	select {
	case channel := <-source.asked:
		if channel != "project:1:events" {
			t.Fatalf("the admitted stream subscribed to %q, want project:1:events", channel)
		}
	default:
		t.Fatal("the admitted stream subscribed to nothing")
	}

	// ── the refused direction: the same sequence, another project ──────────
	//
	// Project 2 exists and has a tenant schema, so a refusal cannot be an
	// accident of a missing schema. The caller holds no role in it.
	for _, refused := range []struct {
		method string
		path   string
		body   map[string]any
	}{
		{http.MethodGet, "/api/v2/configurations/configurations/2?section=ai_credentials", nil},
		{http.MethodGet, "/api/v2/configurations/configurations/administration/2", nil},
		{http.MethodPost, "/api/v2/configurations/configurations/2", map[string]any{"type": "open_ai"}},
		{http.MethodGet, "/api/v2/configurations/configuration/2/1", nil},
		{http.MethodDelete, "/api/v2/configurations/configuration/2/1", nil},
		{http.MethodGet, "/api/v2/configurations/models/2", nil},
		{http.MethodGet, "/api/v2/webhooks/prompt_lib/2/", nil},
		{http.MethodPut, "/api/v2/webhooks/prompt_lib/2/wh-1", map[string]any{"url": "https://attacker.example"}},
		{http.MethodGet, "/api/v2/events/prompt_lib/2/", nil},
	} {
		if status, _ := serveJourney(t, router, refused.method, refused.path, refused.body); status != http.StatusForbidden {
			t.Errorf("%s %s answered %d for a caller who holds no role in project 2, want 403",
				refused.method, refused.path, status)
		}
	}
	// The refused stream must not have subscribed to anything either. A 403 that
	// arrived after the subscription would still have opened the other tenant's
	// bus.
	select {
	case channel := <-source.asked:
		t.Errorf("a refused request subscribed to %q", channel)
	default:
	}

	// A project id that is not a positive integer is refused before any handler
	// builds a schema name from it. Every handler in the package interpolates
	// `p_%s` with %q, which is Go string quoting rather than SQL identifier
	// quoting, so this refusal is what keeps caller text out of the query.
	for _, malformed := range []string{
		"/api/v2/configurations/configurations/1%22",
		"/api/v2/configurations/configurations/not-a-project",
		"/api/v2/configurations/models/0",
	} {
		if status, _ := serveJourney(t, router, http.MethodGet, malformed, nil); status != http.StatusForbidden {
			t.Errorf("GET %s answered %d, want 403 before the handler builds a schema name",
				malformed, status)
		}
	}
}

/* ── harness ───────────────────────────────────────────────────────────── */

// credentialJourneyValidator returns a SESSION-shaped principal.
//
// authenticatedTestUser declares AuthType "token" with no TokenID, and
// legacyrbac refuses that combination outright, so it cannot be used with the
// live resolver.
type credentialJourneyValidator struct{}

func (credentialJourneyValidator) ValidateToken(_ context.Context, token string) (auth.User, error) {
	if token != testAuthToken {
		return auth.User{}, fmt.Errorf("credential journey validator: unexpected token %q", token)
	}
	return auth.User{
		ID:     fmt.Sprint(credentialJourneyUserID),
		UserID: fmt.Sprint(credentialJourneyUserID),
		Email:  "journey-member@test.local",
	}, nil
}

func serveJourney(t *testing.T, router http.Handler, method, path string, body map[string]any) (int, string) {
	t.Helper()
	var payload []byte
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("encode the request body: %v", err)
		}
		payload = encoded
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, testAuthHeader(request))
	return recorder.Code, recorder.Body.String()
}

// seedCredentialJourneyMember reproduces the end-to-end stack's shape: a user,
// a project role in project 1, and PER-PROJECT permission rows.
//
// The per-project rows are the point. legacyrbac reads them first and they
// SUPPRESS the central default-mode fallback, so the corpus grants do not apply
// to project 1 and the seed list is what decides. The list is read from the
// seed script, so a string dropped there fails this test.
func seedCredentialJourneyMember(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), credentialJourneyDeadline)
	defer cancel()

	seeded := projectOneSeededPermissions(t)

	if _, err := pool.Exec(ctx, `
INSERT INTO public.auth_core__user (id, email, name)
VALUES ($1, 'journey-member@test.local', 'Journey member')
ON CONFLICT (id) DO NOTHING`, credentialJourneyUserID); err != nil {
		t.Fatalf("seed the caller: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO public.auth_core__project_role (id, project_id, name)
VALUES ($1, 1, 'editor')
ON CONFLICT (id) DO NOTHING`, credentialJourneyUserID); err != nil {
		t.Fatalf("seed the project role: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO public.auth_core__project_user_role (project_id, user_id, role_id)
VALUES (1, $1, $1)
ON CONFLICT DO NOTHING`, credentialJourneyUserID); err != nil {
		t.Fatalf("assign the project role: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO public.auth_core__project_role_permission (project_id, role_id, permission)
SELECT 1, $1, permission FROM unnest($2::text[]) AS permission
ON CONFLICT DO NOTHING`, credentialJourneyUserID, seeded); err != nil {
		t.Fatalf("seed the per-project permissions: %v", err)
	}
}

// newCredentialJourneyPool builds a throwaway database holding what a real
// deployment holds: the bootstrap schema plus the whole migration corpus. No
// seed script runs here beyond the permission rows above.
func newCredentialJourneyPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if os.Getenv(credentialJourneyDatabaseURL) == "" {
		t.Skipf("set %s to run the credential screen journey", credentialJourneyDatabaseURL)
	}
	pool := newStatusOKIntegrationPool(t)

	ctx, cancel := context.WithTimeout(context.Background(), credentialJourneyDeadline)
	defer cancel()

	source := filepath.Join("..", "infra", "db", "migrations", "001_initial.sql")
	initial, err := os.ReadFile(source)
	if err != nil {
		t.Fatalf("read %s: %v", source, err)
	}
	if _, err := pool.Exec(ctx, string(initial)); err != nil {
		t.Fatalf("apply %s: %v", source, err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO centry.project (id, name, owner_id, create_success)
VALUES (1, 'public', 1, true), (2, 'other-tenant', 1, true)
ON CONFLICT (id) DO NOTHING;
SELECT create_tenant_schema('p_1');
SELECT create_tenant_schema('p_2');`); err != nil {
		t.Fatalf("create the tenant schemas: %v", err)
	}

	runner := migrate.New(pool, migrations.Files)
	if err := runner.ApplyShared(ctx); err != nil {
		t.Fatalf("apply the shared migrations: %v", err)
	}
	for _, projectID := range []int64{1, 2} {
		if err := runner.ApplyTenant(ctx, projectID); err != nil {
			t.Fatalf("apply the tenant migrations to p_%d: %v", projectID, err)
		}
	}
	return pool
}
