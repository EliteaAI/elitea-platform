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
	UserID      int64
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
