package pgvector

import "crypto/rand"

// NewProjectPassword returns the current 20-character alphanumeric project
// password before any external PostgreSQL effect. Application orchestration can
// therefore retry a failed vault handoff by explicitly rotating the
// platform-owned role instead of losing an internally generated password.
func NewProjectPassword() (string, error) {
	return generatePassword(rand.Reader)
}
