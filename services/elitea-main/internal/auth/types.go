package auth

import "context"

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
	ID          string   `json:"id"`
	Email       string   `json:"email"`
	Roles       []string `json:"roles"`
	Permissions []string `json:"permissions"`
	ProjectID   string   `json:"project_id,omitempty"`
	AuthType    string   `json:"auth_type,omitempty"`
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
	case AuthenticationSourceAPIKey, AuthenticationSourceToken, AuthenticationSourceSession:
		return user, true
	default:
		return User{}, false
	}
}
