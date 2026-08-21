package toolkits

// DEFECT: the index write handlers put the raw pgx error into the 500 body:
// `writeJSON(w, 500, map[string]any{"ok": false, "error": err.Error()})` at
// index_write.go:144, 163, 171, 186, 191, 259, 412, 436, 460 and 464, and the
// read handler at handler.go:640 did the same.
//
// `err` is unwrapped driver output. A `*pgconn.PgError` prints
// `ERROR: <message> (SQLSTATE nnnnn)` and carries schema, table and constraint
// names the route never named. A `*pgconn.ConnectError` — what `pool.Begin`
// returns when PostgreSQL is unreachable — prints
// "failed to connect to `user=<db user> database=<db name>`: <host>:<port>",
// which hands the internal database user, database name, host and port to any
// authenticated caller. AGENTS.md:79 forbids a raw `err.Error()` across a
// trust boundary.
//
// The tests below drive a real read fault (a tenant schema that was never
// created) through each mounted route and assert the body carries the fixed
// message only. Against the pre-fix handlers every one of them finds
// "SQLSTATE" in the response.
//
// Requires a PostgreSQL service (ELITEA_TEST_DATABASE_URL); the shared helper
// in create_toolkit_owner_id_test.go creates a throwaway database per test.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// leakingSubstrings are the fragments a raw pgx error carries and a safe body
// must not.
var leakingSubstrings = []string{"SQLSTATE", "database=", "does not exist", "p_9999"}

func assertNoDriverDetail(t *testing.T, route, body string, wantMessage string) {
	t.Helper()
	for _, fragment := range leakingSubstrings {
		if strings.Contains(body, fragment) {
			t.Errorf("%s answered a 500 body carrying %q — the raw driver error reaches the caller: %s",
				route, fragment, body)
		}
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(body), &decoded); err != nil {
		t.Fatalf("%s: decode body %q: %v", route, body, err)
	}
	if got, _ := decoded["error"].(string); got != wantMessage {
		t.Errorf("%s error = %q, want %q", route, got, wantMessage)
	}
	// The envelope keeps its shape; the web client reads `ok`.
	if ok, present := decoded["ok"]; present {
		if flag, _ := ok.(bool); flag {
			t.Errorf("%s reported ok=true beside a 500", route)
		}
	}
}

func TestIndexWriteHandlersHideTheDriverErrorFromTheCaller(t *testing.T) {
	fixture := newIndexWriteFixture(t)

	// p_9999 is never created, so every statement against it fails inside the
	// transaction with a pgconn.PgError.
	const absentProject = "9999"

	t.Run("DELETE index_meta", func(t *testing.T) {
		recorder := fixture.do(t, http.MethodDelete,
			"/index_meta/prompt_lib/"+absentProject+"/"+itoa(fixture.toolkitID)+"/"+itoa(fixture.indexID), "")
		if recorder.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500 (body %s)", recorder.Code, recorder.Body.String())
		}
		assertNoDriverDetail(t, "DELETE index_meta", recorder.Body.String(), "failed to delete the index")
	})

	t.Run("PATCH index_meta", func(t *testing.T) {
		recorder := fixture.do(t, http.MethodPatch,
			"/index_meta/prompt_lib/"+absentProject+"/"+itoa(fixture.toolkitID)+"/"+fixture.indexName,
			`{"timezone":"UTC","cron":"0 0 * * *","enabled":true}`)
		if recorder.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500 (body %s)", recorder.Code, recorder.Body.String())
		}
		assertNoDriverDetail(t, "PATCH index_meta", recorder.Body.String(), "failed to update the index schedule")
	})

	t.Run("DELETE index_cancel", func(t *testing.T) {
		recorder := fixture.do(t, http.MethodDelete,
			"/index_cancel/prompt_lib/"+absentProject+"/"+itoa(fixture.toolkitID)+"/"+fixture.indexName+"/task-abc", "")
		if recorder.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500 (body %s)", recorder.Code, recorder.Body.String())
		}
		assertNoDriverDetail(t, "DELETE index_cancel", recorder.Body.String(), "failed to cancel the index run")
	})
}

// The read route is the easiest of the four to reach — a GET — and it carried
// the same leak at handler.go:640.
func TestIndexMetaListHidesTheDriverErrorFromTheCaller(t *testing.T) {
	fixture := newIndexWriteFixture(t)

	router := chi.NewRouter()
	router.Get("/index_meta/prompt_lib/{projectID}/{toolkitID}", NewHandler(fixture.pool).IndexMeta)

	request := httptest.NewRequest(http.MethodGet,
		"/index_meta/prompt_lib/9999/"+itoa(fixture.toolkitID), nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body %s)", recorder.Code, recorder.Body.String())
	}
	assertNoDriverDetail(t, "GET index_meta", recorder.Body.String(), "failed to list indexes")
}
