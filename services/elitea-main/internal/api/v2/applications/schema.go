package applications

import "github.com/jackc/pgx/v5"

// maxProjectIDDigits bounds a tenant project id well above any real SERIAL
// value while refusing pathological input outright.
const maxProjectIDDigits = 19

// defaultVersionName is the well-known "unnamed default" version name shared
// with the UI (apps/elitea-web/src/entities/version/model/selectors.ts's
// LATEST_VERSION_NAME) and with the repository's own CreateVersion default.
const defaultVersionName = "base"

// tenantSchema returns the project's tenant schema as a fully quoted
// PostgreSQL identifier (e.g. `"p_1"`), ready to interpolate with %s, and
// false when projectID — a raw chi.URLParam — is not a plain decimal id.
//
// The handlers previously built the schema with fmt.Sprintf("p_%s", projectID)
// and interpolated it with %q. %q is a Go string quoter, not a PostgreSQL
// identifier quoter: it escapes an embedded quote as \" where PostgreSQL wants
// it doubled, and PostgreSQL rejects a backslash inside a quoted identifier.
// That combination keeps statement injection out of reach, but it still puts
// unvalidated caller text into the statement, where a hostile id surfaces as a
// 500 carrying a raw SQL syntax error. Validating first keeps it out entirely.
func tenantSchema(projectID string) (string, bool) {
	if projectID == "" || len(projectID) > maxProjectIDDigits {
		return "", false
	}
	for i := 0; i < len(projectID); i++ {
		if projectID[i] < '0' || projectID[i] > '9' {
			return "", false
		}
	}
	return pgx.Identifier{"p_" + projectID}.Sanitize(), true
}
