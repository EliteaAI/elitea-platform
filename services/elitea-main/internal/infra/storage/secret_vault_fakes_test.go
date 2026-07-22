package storage

import (
	"context"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/centrysecrets"
)

// These fakes are shared by the runtime-context and current-vault compatibility
// tests. They deliberately model only exact-name reads; provider-specific
// credential shapes do not belong in the storage boundary.
type fakeSecretVault struct {
	regular map[string]string
	hidden  map[string]string
}

func (v *fakeSecretVault) Lookup(name string) (centrysecrets.Secret, error) {
	if value, ok := v.regular[name]; ok {
		return centrysecrets.Secret{Value: value}, nil
	}
	if value, ok := v.hidden[name]; ok {
		return centrysecrets.Secret{Value: value}, nil
	}
	return centrysecrets.Secret{}, centrysecrets.ErrSecretNotFound
}

func (v *fakeSecretVault) LookupRegular(name string) (centrysecrets.Secret, error) {
	if value, ok := v.regular[name]; ok {
		return centrysecrets.Secret{Value: value}, nil
	}
	return centrysecrets.Secret{}, centrysecrets.ErrSecretNotFound
}

type fakeSecretVaultLoader struct {
	projects     map[int64]SecretVault
	admin        SecretVault
	projectLoads map[int64]int
	adminLoads   int
}

func (l *fakeSecretVaultLoader) LoadProjectVault(_ context.Context, projectID int64) (SecretVault, error) {
	if l.projectLoads != nil {
		l.projectLoads[projectID]++
	}
	vault, ok := l.projects[projectID]
	if !ok || vault == nil {
		return nil, ErrContentUnavailable
	}
	return vault, nil
}

func (l *fakeSecretVaultLoader) LoadAdminVault(context.Context) (SecretVault, error) {
	l.adminLoads++
	if l.admin == nil {
		return nil, ErrContentUnavailable
	}
	return l.admin, nil
}
