package repos

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/tenant"
	"github.com/jackc/pgx/v5"
)

// TestPostgresApplicationVersionDetailsCarryTheAuthoredVariables pins the one
// thing that makes agent variables reach the SDK worker at all.
//
// `application_version_details_json` used to build `'variables', '[]'::jsonb`
// unconditionally, and that key is the SDK worker's PRIMARY variable source:
// `assistant.py:557-576` (elitea-sdk 0.9.8 @ b5113a12, the revision
// `services/elitea-worker-python/elitea-sdk.lock.json` pins) builds
// `prompt_variables` out of `data['variables']`, a LIST of `{name, value}`
// rows, and renders `instructions` through Jinja2 with that map. Its only
// other source is guarded by `isinstance(meta['variables'], dict)` while this
// platform stores an ARRAY, so with the key hardcoded empty an authored
// `{{topic}}` reached the model unsubstituted no matter what the user saved.
//
// The value has no column: `internal/api/v2/applications/handler.go` folds it
// into `application_versions.meta` on create and update, and reads it back out
// under the `variables` key in `versionDetailsResponse`. This test therefore
// seeds `meta`, exactly as the HTTP write does, and reads the projection.
//
// Both queries are asserted, not just the turn: the two copies of the block
// are byte-identical by construction
// (TestSharedApplicationVersionDetailsProjectionsAreIdentical), but that test
// compares SQL TEXT — only a real database says whether the expression the two
// copies share actually resolves to the stored rows.
func TestPostgresApplicationVersionDetailsCarryTheAuthoredVariables(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	seedCurrentAgentContinuationSchema(t, pool)

	tx, err := pool.BeginTx(t.Context(), pgx.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if err := tenant.BindProject(t.Context(), tx, tenant.Project{ID: 1}); err != nil {
		t.Fatal(err)
	}

	// The shape the update path writes: the authored rows alongside the
	// `step_limit` the runtime also reads out of the same object.
	if _, err := tx.Exec(t.Context(), `
UPDATE application_versions
   SET meta = '{"step_limit": 25, "variables": [{"name": "topic", "value": "release notes"}, {"name": "blank", "value": ""}]}'::jsonb
 WHERE id = 41;`); err != nil {
		t.Fatal(err)
	}

	queries := sqlcgen.New(tx)
	turn, err := queries.ResolveCurrentApplicationTurn(
		t.Context(),
		sqlcgen.ResolveCurrentApplicationTurnParams{
			ActorUserID: 11, TargetParticipantID: 21,
			QuestionID:       mustCurrentPGUUID(t, "20000000-0000-4000-8000-000000000031"),
			ConversationUuid: mustCurrentPGUUID(t, "10000000-0000-4000-8000-000000000031"),
			ProjectID:        1,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	nested, err := queries.ResolveCurrentApplicationVersionDetails(
		t.Context(),
		sqlcgen.ResolveCurrentApplicationVersionDetailsParams{
			ApplicationVersionID: 41,
			ApplicationID:        31,
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	// The blank row is projected as authored rather than filtered here: the
	// SDK's own capture skips an empty value ("empty values are runtime
	// placeholders", assistant.py:564-569) and so does the native runtime's
	// `variables::capture_variables`. Dropping it in SQL would hide from both
	// decoders a row the edit page shows, and would make this projection
	// disagree with `versionDetailsResponse`, which returns `meta.variables`
	// verbatim.
	want := []map[string]any{
		{"name": "topic", "value": "release notes"},
		{"name": "blank", "value": ""},
	}
	for name, document := range map[string]string{
		"ResolveCurrentApplicationTurn":           turn.ApplicationVersionDetailsJson,
		"ResolveCurrentApplicationVersionDetails": nested.ApplicationVersionDetailsJson,
	} {
		got := decodeCurrentVersionVariables(t, name, document)
		if len(got) != len(want) {
			t.Fatalf("%s projected %d variables, want %d: %s", name, len(got), len(want), document)
		}
		for index, row := range want {
			for key, value := range row {
				if got[index][key] != value {
					t.Errorf(
						"%s variables[%d][%q] = %v, want %v",
						name, index, key, got[index][key], value,
					)
				}
			}
		}
	}

	// A meta that declares nothing still projects the empty list the decoders
	// expect — the key is never absent and never null.
	for _, meta := range []string{
		`{"step_limit": 25}`,
		`{}`,
		`null`,
		// An OBJECT spelling is deliberately NOT unwrapped into this key: it is
		// not the `{name, value}` list shape either decoder reads here, and both
		// reach that spelling through the `meta` key this projection already
		// carries (the SDK's `isinstance(..., dict)` branch, and the native
		// runtime's object arm of `capture_variables`).
		`{"variables": {"topic": "release notes"}}`,
	} {
		if _, err := tx.Exec(
			t.Context(),
			`UPDATE application_versions SET meta = $1::jsonb WHERE id = 41;`,
			meta,
		); err != nil {
			t.Fatal(err)
		}
		empty, err := queries.ResolveCurrentApplicationVersionDetails(
			t.Context(),
			sqlcgen.ResolveCurrentApplicationVersionDetailsParams{
				ApplicationVersionID: 41,
				ApplicationID:        31,
			},
		)
		if err != nil {
			t.Fatalf("meta %s: %v", meta, err)
		}
		if got := decodeCurrentVersionVariables(t, "meta "+meta, empty.ApplicationVersionDetailsJson); len(got) != 0 {
			t.Errorf("meta %s projected %v, want an empty list", meta, got)
		}
	}
}

func decodeCurrentVersionVariables(t *testing.T, name string, document string) []map[string]any {
	t.Helper()
	var decoded struct {
		Variables *[]map[string]any `json:"variables"`
	}
	if err := json.Unmarshal([]byte(document), &decoded); err != nil {
		t.Fatalf("%s: decode %s: %v", name, document, err)
	}
	if decoded.Variables == nil {
		t.Fatalf("%s: the projection carries no `variables` array: %s", name, document)
	}
	return *decoded.Variables
}
