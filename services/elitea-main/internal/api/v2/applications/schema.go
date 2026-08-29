package applications

import (
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/tenantschema"
)

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
// identifier quoter: it writes an embedded quote as \" where PostgreSQL wants
// it doubled, and PostgreSQL treats the backslash as an ordinary character and
// ENDS the identifier at that quote, so the rest of the caller's text became
// SQL. The validation and the quoting both live in one place now; see
// internal/infra/db/tenantschema and issue #543.
func tenantSchema(projectID string) (string, bool) {
	quoted, err := tenantschema.Quote(projectID)
	if err != nil {
		return "", false
	}
	return quoted, true
}
