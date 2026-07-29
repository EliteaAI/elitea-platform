package auth

import "context"

const (
	PermissionModeAdministration = "administration"
	PermissionModeDeveloper      = "developer"
	PermissionModeDefault        = "default"
)

type PermissionResolution struct {
	UserID      int64
	Permissions []string
}

type PermissionResolver interface {
	ResolvePermissions(
		ctx context.Context,
		principal User,
		mode string,
		projectID string,
	) (PermissionResolution, error)
}
