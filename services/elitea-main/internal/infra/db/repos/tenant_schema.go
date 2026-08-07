package repos

import (
	"github.com/jackc/pgx/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

// maxProjectIDDigits bounds a tenant project id well above any real
// SERIAL/BIGSERIAL value while refusing pathological input outright.
const maxProjectIDDigits = 19

// invalidTenantSchema is the identifier substituted for a project id that is
// not a plain decimal number. `!` cannot appear in a schema created by
// create_tenant_schema (migrations/001_initial.sql), so any query built with
// it fails closed with "relation does not exist" instead of touching data.
const invalidTenantSchema = "p_!invalid"

// isNumericProjectID reports whether projectID is a non-empty run of ASCII
// digits of a plausible length. Tenant schemas are named p_{project_id} where
// project_id is centry.project.id, an integer — nothing else is a project id.
func isNumericProjectID(projectID string) bool {
	if projectID == "" || len(projectID) > maxProjectIDDigits {
		return false
	}
	for i := 0; i < len(projectID); i++ {
		if projectID[i] < '0' || projectID[i] > '9' {
			return false
		}
	}
	return true
}

// schema returns the UNQUOTED tenant schema name for callers that interpolate
// it with %q.
//
// %q is not a PostgreSQL identifier quoter: it escapes an embedded quote as \"
// (Go syntax), where PostgreSQL wants it doubled, and PostgreSQL rejects a
// backslash inside a quoted identifier outright. That combination happens to
// make statement injection through this helper unreachable — the server
// answers a hostile project id with a syntax error rather than running the
// injected text — but it also means an unvalidated project id is interpolated
// into SQL and surfaces as a 500 carrying a raw SQL error. Validating here
// keeps caller-supplied text out of the statement entirely.
//
// New code should use tenantSchema, which returns an already-quoted
// pgx.Identifier and an error instead of a fail-closed sentinel.
func schema(projectID string) string {
	if !isNumericProjectID(projectID) {
		return invalidTenantSchema
	}
	return "p_" + projectID
}

// tenantSchema returns the project's tenant schema as a fully quoted
// PostgreSQL identifier (e.g. `"p_1"`), ready to interpolate with %s, or a
// 400 when projectID is not a plain decimal project id.
func tenantSchema(projectID string) (string, error) {
	if !isNumericProjectID(projectID) {
		return "", apierr.BadRequest("invalid project id")
	}
	return pgx.Identifier{"p_" + projectID}.Sanitize(), nil
}

// isNumericRowID reports whether an id path parameter is a plain decimal row
// id. Row ids reach SQL as bind parameters, so a non-numeric one is not an
// injection risk — it is simply an id that cannot exist, and PostgreSQL would
// answer it with "invalid input syntax for type integer" (a 500) instead of a
// 404.
func isNumericRowID(id string) bool { return isNumericProjectID(id) }
