package repos

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/tenant"
	"github.com/jackc/pgx/v5"
)

// TestPostgresNestedApplicationVersionProjectsTheSameDocumentAsTheTurn is the
// only test that can hold the two projections together.
//
// ResolveCurrentApplicationVersionDetails is a COPY of
// ResolveCurrentApplicationTurn's version block (agent_chat.sql), and a copy
// drifts. The native runtime decodes the parent's document and every nested
// child's with one decoder, so a divergence would not fail here or in any unit
// test — it would fail at assembly time, in a worker span, on whichever agent
// happened to use the field that moved. Comparing the two strings byte for byte
// on one seeded version is what keeps the copy honest.
func TestPostgresNestedApplicationVersionProjectsTheSameDocumentAsTheTurn(t *testing.T) {
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
	// The seed attaches a skill to version 41 but no toolkit. Both subqueries
	// have to be non-empty for this comparison to mean anything: an empty
	// `tools` array would match between the two projections no matter how far
	// their tool clauses had drifted.
	if _, err := tx.Exec(t.Context(), `
INSERT INTO entity_tool_mapping (
    id, tool_id, entity_id, entity_version_id, entity_type, selected_tools
) VALUES
    (91, 51, 31, 41, 'agent', '["list_products"]'::jsonb);`); err != nil {
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
	if nested.ApplicationVersionID != 41 || nested.ApplicationID != 31 {
		t.Fatalf(
			"nested projection returned identity %d/%d, want 41/31",
			nested.ApplicationVersionID,
			nested.ApplicationID,
		)
	}
	// Guard against a vacuous comparison: two empty documents would also be
	// equal. The seeded toolkit, its narrowed selection and the seeded skill all
	// have to be present for the equality below to be evidence of anything.
	for _, marker := range []string{
		`"toolkit_name": "product"`,
		`"selected_tools": ["list_products"]`,
		`"available_tools": ["list_products"]`,
		`"name": "release-proof"`,
	} {
		if !strings.Contains(nested.ApplicationVersionDetailsJson, marker) {
			t.Fatalf(
				"nested projection omits %s: %s",
				marker,
				nested.ApplicationVersionDetailsJson,
			)
		}
	}
	if nested.ApplicationVersionDetailsJson != turn.ApplicationVersionDetailsJson {
		t.Fatalf(
			"nested version projection drifted from the turn projection\nnested: %s\nturn:   %s",
			nested.ApplicationVersionDetailsJson,
			turn.ApplicationVersionDetailsJson,
		)
	}

	// The application id is a filter, not a label: a version that belongs to a
	// different application must not resolve for the pair the worker asked for.
	if _, err := queries.ResolveCurrentApplicationVersionDetails(
		t.Context(),
		sqlcgen.ResolveCurrentApplicationVersionDetailsParams{
			ApplicationVersionID: 41,
			ApplicationID:        32,
		},
	); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("mismatched application identity resolved a version: %v", err)
	}
	if _, err := queries.ResolveCurrentApplicationVersionDetails(
		t.Context(),
		sqlcgen.ResolveCurrentApplicationVersionDetailsParams{
			ApplicationVersionID: 999,
			ApplicationID:        31,
		},
	); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("absent version resolved a document: %v", err)
	}
}
