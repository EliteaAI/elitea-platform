package auth

import (
	"context"
	"errors"
)

const (
	PermissionModeAdministration = "administration"
	PermissionModeDeveloper      = "developer"
	PermissionModeDefault        = "default"
)

// ErrPermissionDenied is the sentinel for an authorization REFUSAL.
//
// A PermissionResolver must return this error, or an error that wraps it, when
// it refuses the principal. The resolver must return any other error only for
// an infrastructure failure: a lost database connection, a query timeout, or a
// canceled context. Callers use the difference to select the status code. A
// refusal is 403. An infrastructure failure is 500.
//
// Do not report an infrastructure failure as a refusal. The operator then sees
// a wall of 403 answers, with no error rate signal, and audits roles instead of
// the database.
var ErrPermissionDenied = errors.New("permission denied")

type PermissionResolution struct {
	// UserID is the RESOLVED user, and an implementation returning a nil error
	// must populate it with a positive id.
	//
	// It is not an echo of what the principal claimed. For a token principal
	// the claimed id is the TOKEN's, and reporting the owning user is the whole
	// point of resolving: callers use this field as a user foreign key and as
	// the identity they display. A resolver that leaves it zero on success
	// makes every such caller drop the resolution — silently, since there is
	// nothing to log.
	UserID int64
	// Permissions may be empty. Empty means "this principal holds none in this
	// mode", which is an ANSWER; a refusal is ErrPermissionDenied instead.
	Permissions []string
}

// PermissionResolver resolves the permissions of a principal in one mode.
//
// The implementation must obey the ErrPermissionDenied contract above.
type PermissionResolver interface {
	ResolvePermissions(
		ctx context.Context,
		principal User,
		mode string,
		projectID string,
	) (PermissionResolution, error)
}
