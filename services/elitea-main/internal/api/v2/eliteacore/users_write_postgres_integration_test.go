package eliteacore_test

// #130 acceptance.
//
// The defect these tests exist for is NOT "the endpoint answers the wrong
// status" — the broken build answered 200 to POST, PUT and DELETE alike, which
// is exactly what a working one answers. Asserting on the status therefore
// proves nothing at all. Every case below performs the write and then RE-READS
// the membership through the product's own GET handler (and, where the read
// path could conceivably paper over a miss, through SQL as well). Against the
// pre-fix router — all four verbs mounted on Handler.Users — every one of these
// re-reads returns the untouched member list and the test fails.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/eliteacore"
	dbschema "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/schema"
)

const usersWriteProjectID = 1

type usersListBody struct {
	Rows []struct {
		ID    string   `json:"id"`
		Email string   `json:"email"`
		Name  string   `json:"name"`
		Roles []string `json:"roles"`
	} `json:"rows"`
	Total int `json:"total"`
}

// usersWriteRouter mounts the four verbs exactly as internal/api/router.go
// does, minus the permission middleware (which needs the whole auth stack; the
// E2E journey covers it through a real logged-in session instead).
func usersWriteRouter(handler *eliteacore.Handler) chi.Router {
	router := chi.NewRouter()
	router.Get("/admin/users/{mode}/{projectID}", handler.Users)
	router.Post("/admin/users/{mode}/{projectID}", handler.UsersCreate)
	router.Put("/admin/users/{mode}/{projectID}", handler.UsersUpdate)
	router.Delete("/admin/users/{mode}/{projectID}", handler.UsersDelete)
	return router
}

func usersWriteDo(t *testing.T, router chi.Router, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}
	request := httptest.NewRequest(method, target, reader)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

// readMembers re-reads the project membership through the SAME GET handler the
// Users page calls. This is the assertion that the pre-fix code cannot pass.
func readMembers(t *testing.T, router chi.Router) usersListBody {
	t.Helper()
	recorder := usersWriteDo(t, router, http.MethodGet,
		fmt.Sprintf("/admin/users/default/%d?limit=100&offset=0", usersWriteProjectID), nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("re-read GET status = %d, want 200 (body %s)", recorder.Code, recorder.Body.String())
	}
	var listing usersListBody
	if err := json.Unmarshal(recorder.Body.Bytes(), &listing); err != nil {
		t.Fatalf("decode re-read body %q: %v", recorder.Body.String(), err)
	}
	return listing
}

func memberRoles(listing usersListBody, email string) ([]string, bool) {
	for _, row := range listing.Rows {
		if row.Email == email {
			roles := append([]string(nil), row.Roles...)
			sort.Strings(roles)
			return roles, true
		}
	}
	return nil, false
}

func TestUsersWriteVerbsPersistProjectMembership(t *testing.T) {
	pool := newUsersWritePostgresPool(t)
	prepareUsersWriteFixture(t, pool)
	router := usersWriteRouter(eliteacore.NewHandler(pool))

	const invited = "e2e-invited@autotest.local"
	const existing = "e2e-member@autotest.local"

	t.Run("POST invites an unknown address and the member list shows it", func(t *testing.T) {
		before := readMembers(t, router)
		if _, found := memberRoles(before, invited); found {
			t.Fatalf("fixture already contains %s", invited)
		}

		recorder := usersWriteDo(t, router, http.MethodPost,
			fmt.Sprintf("/admin/users/default/%d", usersWriteProjectID),
			map[string]any{"emails": []string{invited}, "roles": []string{"editor"}})
		if recorder.Code != http.StatusOK {
			t.Fatalf("POST status = %d, want 200 (body %s)", recorder.Code, recorder.Body.String())
		}

		// THE assertion: read it back the way the page does.
		after := readMembers(t, router)
		roles, found := memberRoles(after, invited)
		if !found {
			t.Fatalf("invited address %s absent from the re-read member list %+v", invited, after.Rows)
		}
		if len(roles) != 1 || roles[0] != "editor" {
			t.Fatalf("invited member roles = %v, want [editor]", roles)
		}
		if after.Total != before.Total+1 {
			t.Fatalf("total = %d after inviting one member, want %d", after.Total, before.Total+1)
		}

		// The invite must have created the auth_core__user row too, not just a
		// dangling role assignment.
		var userCount int
		if err := pool.QueryRow(context.Background(),
			`SELECT COUNT(*) FROM auth_core__user WHERE email = $1`, invited).Scan(&userCount); err != nil {
			t.Fatal(err)
		}
		if userCount != 1 {
			t.Fatalf("auth_core__user rows for %s = %d, want 1", invited, userCount)
		}
	})

	t.Run("POST reports an existing member as an error and adds no duplicate", func(t *testing.T) {
		before := readMembers(t, router)

		recorder := usersWriteDo(t, router, http.MethodPost,
			fmt.Sprintf("/admin/users/default/%d", usersWriteProjectID),
			map[string]any{"emails": []string{existing}, "roles": []string{"viewer"}})
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("POST for an existing member status = %d, want 400 (body %s)",
				recorder.Code, recorder.Body.String())
		}

		after := readMembers(t, router)
		if after.Total != before.Total {
			t.Fatalf("total changed from %d to %d on a rejected invite", before.Total, after.Total)
		}
		roles, _ := memberRoles(after, existing)
		if len(roles) != 1 || roles[0] != "editor" {
			t.Fatalf("existing member roles = %v after a rejected invite, want [editor]", roles)
		}
	})

	t.Run("POST rejects a role the project does not define and writes nothing", func(t *testing.T) {
		before := readMembers(t, router)

		recorder := usersWriteDo(t, router, http.MethodPost,
			fmt.Sprintf("/admin/users/default/%d", usersWriteProjectID),
			map[string]any{"emails": []string{"e2e-nobody@autotest.local"}, "roles": []string{"wizard"}})
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("POST with an unknown role status = %d, want 400", recorder.Code)
		}

		after := readMembers(t, router)
		if _, found := memberRoles(after, "e2e-nobody@autotest.local"); found {
			t.Fatal("a rejected invite still added the member")
		}
		if after.Total != before.Total {
			t.Fatalf("total changed from %d to %d on a rejected invite", before.Total, after.Total)
		}
	})

	t.Run("PUT replaces the role set and the member list shows the new role", func(t *testing.T) {
		before := readMembers(t, router)
		roles, found := memberRoles(before, existing)
		if !found || len(roles) != 1 || roles[0] != "editor" {
			t.Fatalf("precondition: %s roles = %v, want [editor]", existing, roles)
		}
		userID := ""
		for _, row := range before.Rows {
			if row.Email == existing {
				userID = row.ID
			}
		}

		// The exact body the client sends: entities/user/model/useEditUser.ts:30.
		recorder := usersWriteDo(t, router, http.MethodPut,
			fmt.Sprintf("/admin/users/default/%d", usersWriteProjectID),
			map[string]any{"userId": userID, "roles": []string{"admin"}})
		if recorder.Code != http.StatusOK {
			t.Fatalf("PUT status = %d, want 200 (body %s)", recorder.Code, recorder.Body.String())
		}

		after := readMembers(t, router)
		roles, found = memberRoles(after, existing)
		if !found {
			t.Fatalf("%s disappeared from the member list after an edit", existing)
		}
		// REPLACEMENT, not merge: `editor` must be gone. A handler that only
		// inserted the new role would still show [admin editor] here.
		if len(roles) != 1 || roles[0] != "admin" {
			t.Fatalf("roles after edit = %v, want [admin]", roles)
		}
	})

	t.Run("PUT accepts the comma-joined batch id form", func(t *testing.T) {
		before := readMembers(t, router)
		ids := make([]string, 0, 2)
		for _, row := range before.Rows {
			if row.Email == existing || row.Email == invited {
				ids = append(ids, row.ID)
			}
		}
		if len(ids) != 2 {
			t.Fatalf("precondition: expected both members present, got %+v", before.Rows)
		}

		// useEditUser.ts:61 joins the selected ids with a comma into ONE string.
		recorder := usersWriteDo(t, router, http.MethodPut,
			fmt.Sprintf("/admin/users/default/%d", usersWriteProjectID),
			map[string]any{"userId": ids[0] + "," + ids[1], "roles": []string{"viewer"}})
		if recorder.Code != http.StatusOK {
			t.Fatalf("batch PUT status = %d, want 200 (body %s)", recorder.Code, recorder.Body.String())
		}

		after := readMembers(t, router)
		for _, email := range []string{existing, invited} {
			roles, found := memberRoles(after, email)
			if !found {
				t.Fatalf("%s missing after a batch edit", email)
			}
			if len(roles) != 1 || roles[0] != "viewer" {
				t.Fatalf("%s roles after batch edit = %v, want [viewer]", email, roles)
			}
		}
	})

	t.Run("DELETE removes the member from the project but keeps the account", func(t *testing.T) {
		before := readMembers(t, router)
		userID := ""
		for _, row := range before.Rows {
			if row.Email == invited {
				userID = row.ID
			}
		}
		if userID == "" {
			t.Fatalf("precondition: %s not in the member list", invited)
		}

		// shared/api/generated/admin/admin.ts's getUserDeleteUrl stringifies the
		// id array into ONE `id[]` occurrence.
		recorder := usersWriteDo(t, router, http.MethodDelete,
			fmt.Sprintf("/admin/users/default/%d?id%%5B%%5D=%s", usersWriteProjectID, userID), nil)
		if recorder.Code != http.StatusOK {
			t.Fatalf("DELETE status = %d, want 200 (body %s)", recorder.Code, recorder.Body.String())
		}

		after := readMembers(t, router)
		if _, found := memberRoles(after, invited); found {
			t.Fatalf("%s is still a member after DELETE: %+v", invited, after.Rows)
		}
		if after.Total != before.Total-1 {
			t.Fatalf("total = %d after removing one member, want %d", after.Total, before.Total-1)
		}

		// "Remove from project" is not "delete the account".
		var userCount int
		if err := pool.QueryRow(context.Background(),
			`SELECT COUNT(*) FROM auth_core__user WHERE email = $1`, invited).Scan(&userCount); err != nil {
			t.Fatal(err)
		}
		if userCount != 1 {
			t.Fatalf("auth_core__user rows for %s = %d after removal from the project, want 1", invited, userCount)
		}
	})

	// Administration mode used to answer 501 here, and this case used to assert
	// it. That was a hole, not a policy: `/admin/users/{mode}/{projectID}`
	// carries the project id in its own path, pylon's users.py maps BOTH modes
	// to the same body, and the admin Projects page's member dialog is exactly
	// this call — so it reached a Not Implemented (unit A14, #200). It writes
	// for real now; what differs between the modes is the route-level GATE
	// (router.go resolves `configuration.users.users.*` centrally for
	// administration mode), not the query.
	t.Run("administration mode writes the membership", func(t *testing.T) {
		const invited = "e2e-admin-mode@autotest.local"
		before := readMembers(t, router)
		recorder := usersWriteDo(t, router, http.MethodPost,
			fmt.Sprintf("/admin/users/administration/%d", usersWriteProjectID),
			map[string]any{"emails": []string{invited}, "roles": []string{"admin"}})
		if recorder.Code != http.StatusOK {
			t.Fatalf("administration-mode POST status = %d, want 200 (body %s)",
				recorder.Code, recorder.Body.String())
		}

		// RE-READ through the product's own GET.
		after := readMembers(t, router)
		roles, found := memberRoles(after, invited)
		if !found {
			t.Fatalf("%s is not a member after an administration-mode invite", invited)
		}
		if len(roles) != 1 || roles[0] != "admin" {
			t.Fatalf("%s holds %v after the invite, want [admin]", invited, roles)
		}
		if after.Total != before.Total+1 {
			t.Fatalf("total = %d after one administration-mode invite, want %d", after.Total, before.Total+1)
		}
	})

	// Neither mode may write project 0's membership — the original reason the
	// administration branch was closed off. The project id is still required to
	// be a concrete positive integer.
	t.Run("administration mode still requires a real project id", func(t *testing.T) {
		for _, badID := range []string{"0", "-1", "abc"} {
			recorder := usersWriteDo(t, router, http.MethodPost,
				"/admin/users/administration/"+badID,
				map[string]any{"emails": []string{"e2e-nowhere@autotest.local"}, "roles": []string{"admin"}})
			if recorder.Code != http.StatusBadRequest {
				t.Errorf("administration-mode POST to project %q status = %d, want 400", badID, recorder.Code)
			}
		}
	})
}

/* ── fixture ─────────────────────────────────────────────────────────────── */

func prepareUsersWriteFixture(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	statements := []string{
		`INSERT INTO public.auth_core__group (id, name) VALUES (1, 'Root')`,
		`INSERT INTO public.auth_core__user (email, name) VALUES
			('e2e-admin@autotest.local', 'E2E Admin'),
			('e2e-member@autotest.local', 'E2E Member')`,
		fmt.Sprintf(`INSERT INTO public.auth_core__project_role (project_id, name) VALUES
			(%d, 'admin'), (%d, 'editor'), (%d, 'viewer')`,
			usersWriteProjectID, usersWriteProjectID, usersWriteProjectID),
		fmt.Sprintf(`INSERT INTO public.auth_core__project_user_role (project_id, user_id, role_id)
			SELECT %d, u.id, r.id
			FROM public.auth_core__user u
			JOIN public.auth_core__project_role r ON r.project_id = %d AND r.name = 'admin'
			WHERE u.email = 'e2e-admin@autotest.local'`, usersWriteProjectID, usersWriteProjectID),
		fmt.Sprintf(`INSERT INTO public.auth_core__project_user_role (project_id, user_id, role_id)
			SELECT %d, u.id, r.id
			FROM public.auth_core__user u
			JOIN public.auth_core__project_role r ON r.project_id = %d AND r.name = 'editor'
			WHERE u.email = 'e2e-member@autotest.local'`, usersWriteProjectID, usersWriteProjectID),
	}
	for _, statement := range statements {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("seed %q: %v", statement, err)
		}
	}
}

func newUsersWritePostgresPool(t *testing.T) *pgxpool.Pool {
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

	databaseName := fmt.Sprintf("elitea_users_write_it_%d_%d", os.Getpid(), time.Now().UnixNano())
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
		if _, dropErr := adminPool.Exec(context.Background(), "DROP DATABASE "+quotedDatabase+" WITH (FORCE)"); dropErr != nil {
			t.Errorf("drop database after pool open failure: %v", dropErr)
		}
		adminPool.Close()
		t.Fatalf("open isolated PostgreSQL integration database: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer dropCancel()
		if _, err := adminPool.Exec(dropCtx, "DROP DATABASE "+quotedDatabase+" WITH (FORCE)"); err != nil {
			t.Errorf("drop isolated PostgreSQL integration database: %v", err)
		}
		adminPool.Close()
	})

	if _, err := pool.Exec(ctx, dbschema.AuthCoreBaselineSQLCProjection); err != nil {
		t.Fatalf("apply auth_core baseline projection: %v", err)
	}
	return pool
}
