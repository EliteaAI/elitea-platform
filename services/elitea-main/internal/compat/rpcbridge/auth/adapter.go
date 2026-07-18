// Package auth provides an adapter wrapping authsvc.Client (Redis RPC)
// behind a domain-level token validation interface. When elitea-auth gains
// gRPC, swap this for a gRPC-backed implementation.
package auth

import (
	"context"

	authpkg "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
)

// TokenValidator is the domain port for authentication.
type TokenValidator interface {
	ValidateToken(ctx context.Context, token string) (authpkg.User, error)
}

// Adapter wraps the Redis RPC auth client.
type Adapter struct {
	client *authsvc.Client
}

func New(client *authsvc.Client) *Adapter {
	return &Adapter{client: client}
}

func (a *Adapter) ValidateToken(ctx context.Context, token string) (authpkg.User, error) {
	return a.client.ValidateToken(ctx, token)
}

var _ TokenValidator = (*Adapter)(nil)
