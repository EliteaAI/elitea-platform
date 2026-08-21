package auth

import (
	"context"
	"errors"
	"strconv"
	"strings"
)

var ErrPrincipalInactive = errors.New("authenticated principal is inactive")

type ctxKey string

const ctxKeyUser ctxKey = "auth.user"
const ctxKeyAuthenticationSource ctxKey = "auth.source"

type AuthenticationSource uint8

const (
	AuthenticationSourceUnknown AuthenticationSource = iota
	AuthenticationSourceForwarded
	AuthenticationSourceAPIKey
	AuthenticationSourceToken
	AuthenticationSourceSession
	AuthenticationSourceDevelopment
)

type User struct {
	ID          string   `json:"id"`                 // Compatibility owning-user ID after validation; use UserID/TokenID at security boundaries.
	UserID      string   `json:"user_id,omitempty"`  // Owning auth_core__user ID when resolved.
	TokenID     string   `json:"token_id,omitempty"` // auth_core__token ID when the source principal is a token.
	Email       string   `json:"email"`
	Name        string   `json:"name,omitempty"`
	Roles       []string `json:"roles"`
	Permissions []string `json:"permissions"`
	ProjectID   string   `json:"project_id,omitempty"`
	AuthType    string   `json:"auth_type,omitempty"`
	// TokenProjectID is the project this access token is bound to, or nil when
	// the token is unbound. Unbound is the default and stays the default: no
	// existing token carries a binding (ADR-0018, spec-llm-project-scope §3.2).
	//
	// Only a credential validator that READ THE BINDING FROM STORAGE may set
	// this field. It MUST NOT be derived from any request header, from the
	// token `name`, or from the principal `name`. The token name is
	// caller-supplied free text of up to 768 bytes, so a field derived from it
	// would be self-service authorization over another project's budget and
	// provider credentials (spec §7 invariant 2).
	TokenProjectID *int64 `json:"token_project_id,omitempty"`
	// TokenProjectActive reports whether the bound project is still active. It
	// is a tri-state on purpose:
	//
	//   nil   — the validator did not determine the state. Treat the binding
	//           as usable, which is the behaviour of every validator that
	//           reads no storage.
	//   true  — the bound project exists, is created, and is not suspended.
	//   false — the bound project is suspended, not created, or gone. The
	//           edge MUST refuse the request.
	//
	// A binding must not outlive membership (spec-llm-project-scope §7
	// invariant 3). Suspension revokes no binding, so the state is re-checked
	// here at resolution time. Only a credential validator that read the
	// project row from storage may set this field.
	TokenProjectActive *bool `json:"token_project_active,omitempty"`
}

// BoundProjectRefused reports a binding whose project is no longer usable.
// The caller must refuse the request rather than fall back to another project:
// a fallback moves the spend the suspension was meant to stop.
func (u User) BoundProjectRefused() bool {
	return u.TokenProjectID != nil && u.TokenProjectActive != nil && !*u.TokenProjectActive
}

// OwningUserID returns the database user that owns the authenticated identity.
// Token IDs are never accepted as author IDs. A fully validated token
// principal carries the token row in TokenID and its owner in both UserID and
// the compatibility ID used by legacy handlers.
func (u User) OwningUserID() (int64, bool) {
	if u.UserID != "" {
		return positiveID(u.UserID)
	}
	if u.TokenID != "" || strings.EqualFold(u.AuthType, "token") {
		return 0, false
	}
	return positiveID(u.ID)
}

func positiveID(value string) (int64, bool) {
	id, err := strconv.ParseInt(value, 10, 64)
	return id, err == nil && id > 0
}

func UserFromContext(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(ctxKeyUser).(User)
	return u, ok
}

func ContextWithUser(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, ctxKeyUser, u)
}

// ContextWithAuthenticatedUser records server-derived authentication
// provenance using an unexported context key. Public request headers cannot
// forge this marker. ContextWithUser intentionally does not add provenance so
// legacy call sites remain compatible while sensitive runtime routes fail
// closed unless they passed through the authentication middleware.
func ContextWithAuthenticatedUser(ctx context.Context, user User, source AuthenticationSource) context.Context {
	ctx = ContextWithUser(ctx, user)
	return context.WithValue(ctx, ctxKeyAuthenticationSource, source)
}

func AuthenticationSourceFromContext(ctx context.Context) (AuthenticationSource, bool) {
	source, ok := ctx.Value(ctxKeyAuthenticationSource).(AuthenticationSource)
	return source, ok && source != AuthenticationSourceUnknown
}

func RuntimePrincipalFromContext(ctx context.Context) (User, bool) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return User{}, false
	}
	source, ok := AuthenticationSourceFromContext(ctx)
	if !ok {
		return User{}, false
	}
	switch source {
	case AuthenticationSourceForwarded, AuthenticationSourceAPIKey, AuthenticationSourceToken, AuthenticationSourceSession:
		return user, true
	default:
		return User{}, false
	}
}
