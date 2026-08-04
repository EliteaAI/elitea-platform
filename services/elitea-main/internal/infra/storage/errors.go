package storage

import "errors"

// Sentinel errors returned by ObjectStore implementations. Backends must map
// their provider-specific errors onto these so callers can use errors.Is
// without depending on a particular backend's error types.
var (
	ErrNotFound           = errors.New("storage: not found")
	ErrAlreadyExists      = errors.New("storage: already exists")
	ErrAccessDenied       = errors.New("storage: access denied")
	ErrPreconditionFailed = errors.New("storage: precondition failed")
	ErrTooLarge           = errors.New("storage: object too large")
	ErrInvalidKey         = errors.New("storage: invalid object reference")
	ErrNotSupported       = errors.New("storage: operation not supported by backend")
)
