package configurations

// The defect: the compatibility Update assigned `data`, `meta` and `shared`
// unconditionally.
//
// The evidence: the body was decoded into map[string]any and read with
// `body["data"].(map[string]any)`, `json.Marshal(body["meta"])` and
// `body["shared"].(bool)`. A type assertion cannot tell an absent key from an
// empty value, so an omitted `data` became `{}`, an omitted `meta` became JSON
// null, and an omitted `shared` became false. The statement then wrote all
// three. Only the four string columns carried a COALESCE guard.
//
// The failure: a client sends PUT with `{"shared":true}` — the reference
// implementation documents that body, and it parses with `exclude_unset=True`,
// so only `shared` is written there. Here the row's
// `{"api_key":"...","api_base":"..."}` was replaced by `{}`. No copy of that
// column exists, so the credential was unrecoverable. Provider admission then
// re-ran over the emptied row and wrote status_ok = false, which withdrew the
// credential from the LLM gateway too.
//
// The package's HTTP tests cannot see this: setupConfigRouter passes a nil
// pool, so Update is excluded there by design. These tests read the statement
// the handler builds, which needs no database.

import (
	"strings"
	"testing"
)

func newUpdateTestHandler(t *testing.T) *Handler {
	t.Helper()
	return NewHandler(nil)
}

// assignedColumns returns the column names the SET list writes.
func assignedColumns(t *testing.T, query string) map[string]bool {
	t.Helper()
	setList := query[strings.Index(query, "SET")+len("SET") : strings.Index(query, "WHERE")]
	columns := map[string]bool{}
	for _, assignment := range strings.Split(setList, ",") {
		name := strings.TrimSpace(assignment)
		if index := strings.Index(name, " ="); index > 0 {
			columns[name[:index]] = true
		}
	}
	return columns
}

func TestUpdateLeavesOmittedColumnsAlone(t *testing.T) {
	handler := newUpdateTestHandler(t)

	query, args, reason := handler.buildConfigurationUpdate(
		map[string]any{"shared": true}, "p_7", "12",
	)
	if reason != "" {
		t.Fatalf("a body of {\"shared\":true} was refused: %s", reason)
	}

	columns := assignedColumns(t, query)
	for _, column := range []string{"data", "meta"} {
		if columns[column] {
			t.Fatalf("the statement writes %q, which the body does not carry; the stored value is lost", column)
		}
	}
	if !columns["shared"] {
		t.Fatal("the statement does not write `shared`, which the body does carry")
	}

	// The four string columns, `shared`, and the WHERE identifier.
	if len(args) != 6 {
		t.Fatalf("bound %d arguments, want 6: %v", len(args), args)
	}
	if args[len(args)-1] != "12" {
		t.Fatalf("the last argument is %v, want the configuration id", args[len(args)-1])
	}
	if args[4] != true {
		t.Fatalf("the `shared` argument is %v, want true", args[4])
	}
}

func TestUpdateOmittingSharedDoesNotUnshareTheRow(t *testing.T) {
	handler := newUpdateTestHandler(t)

	query, _, reason := handler.buildConfigurationUpdate(
		map[string]any{"elitea_title": "prod"}, "p_7", "12",
	)
	if reason != "" {
		t.Fatalf("a rename was refused: %s", reason)
	}
	if assignedColumns(t, query)["shared"] {
		t.Fatal("a rename writes `shared`, so it silently un-shares a shared row")
	}
}

func TestUpdateWritesTheColumnsTheBodyCarries(t *testing.T) {
	handler := newUpdateTestHandler(t)

	query, args, reason := handler.buildConfigurationUpdate(map[string]any{
		"data":   map[string]any{"api_key": "sk-test"},
		"meta":   map[string]any{"note": "n"},
		"shared": false,
	}, "p_7", "12")
	if reason != "" {
		t.Fatalf("a full body was refused: %s", reason)
	}

	columns := assignedColumns(t, query)
	for _, column := range []string{"data", "meta", "shared"} {
		if !columns[column] {
			t.Fatalf("the statement does not write %q, which the body carries", column)
		}
	}
	// The four string columns, the three above, and the WHERE identifier.
	if len(args) != 8 {
		t.Fatalf("bound %d arguments, want 8", len(args))
	}
	if !strings.Contains(query, "WHERE id = $8") {
		t.Fatalf("the WHERE placeholder is not the last argument: %s", query)
	}
}

// A present `meta: null` becomes an empty object. The column holds a dictionary
// in the reference model and in every reader, so a JSON null there is
// off-contract.
func TestUpdateNormalizesAPresentNullObject(t *testing.T) {
	handler := newUpdateTestHandler(t)

	_, args, reason := handler.buildConfigurationUpdate(
		map[string]any{"meta": nil}, "p_7", "12",
	)
	if reason != "" {
		t.Fatalf("a body of {\"meta\":null} was refused: %s", reason)
	}
	encoded, ok := args[4].([]byte)
	if !ok {
		t.Fatalf("the `meta` argument is %T, want the encoded object", args[4])
	}
	if string(encoded) != "{}" {
		t.Fatalf("the `meta` argument is %q, want %q", encoded, "{}")
	}
}

// A present field of the wrong JSON type is refused. It used to default
// silently: `"data":"oops"` became `{}` and `"shared":1` became false, so a
// malformed body wiped the row exactly as an absent key did.
func TestUpdateRefusesAPresentFieldOfTheWrongType(t *testing.T) {
	handler := newUpdateTestHandler(t)

	for name, body := range map[string]map[string]any{
		"data is a string":     {"data": "oops"},
		"meta is a list":       {"meta": []any{1}},
		"shared is a number":   {"shared": float64(1)},
		"shared is a string":   {"shared": "true"},
		"data is a number":     {"data": float64(3)},
		"data is a JSON false": {"data": false},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, reason := handler.buildConfigurationUpdate(body, "p_7", "12"); reason == "" {
				t.Fatalf("%v was accepted; a wrong-typed field must not default to a wipe", body)
			}
		})
	}
}
