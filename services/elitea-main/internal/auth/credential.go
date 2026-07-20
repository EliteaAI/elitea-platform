package auth

import "errors"

var (
	// ErrCredentialRejected is an ordinary authentication result: the supplied
	// credential is malformed, expired, revoked, or unknown.
	ErrCredentialRejected = errors.New("authentication credential rejected")
	// ErrCredentialValidationUnavailable identifies configuration, storage, or
	// integrity failures while checking a credential. Callers must fail closed
	// without converting this outage into anonymous or public access.
	ErrCredentialValidationUnavailable = errors.New("authentication credential validation unavailable")
)
