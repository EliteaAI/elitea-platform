package storage

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/centrysecrets"
)

func TestCurrentIndexMetaTimeoutResolverPreservesCurrentVaultContract(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		secret  string
		missing bool
		want    time.Duration
	}{
		{name: "missing uses current default", missing: true, want: 7200 * time.Second},
		{name: "configured seconds", secret: "45", want: 45 * time.Second},
		{name: "zero remains valid", secret: "0", want: 0},
		{name: "negative remains compatible", secret: "-1", want: -time.Second},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			vault := &currentIndexMetaVaultStub{regular: map[string]centrysecrets.Secret{}}
			if !test.missing {
				vault.regular[currentIndexMetaStaleTimeoutKey] = centrysecrets.Secret{Value: test.secret}
			}
			loader := &currentIndexMetaVaultLoaderStub{project: vault}
			resolver, err := NewCurrentIndexMetaTimeoutResolver(loader)
			if err != nil {
				t.Fatal(err)
			}

			got, err := resolver.ResolveCurrentIndexMetaStaleTimeout(context.Background(), 17)
			if err != nil || got != test.want || loader.projectID != 17 {
				t.Fatalf("ResolveCurrentIndexMetaStaleTimeout() = %v, %v; project=%d", got, err, loader.projectID)
			}
		})
	}
}

func TestCurrentIndexMetaTimeoutResolverFailsClosedAndPreservesCancellation(t *testing.T) {
	t.Parallel()

	secret := "secret-canary"
	tests := []struct {
		name   string
		ctx    context.Context
		loader *currentIndexMetaVaultLoaderStub
		want   error
	}{
		{name: "invalid timeout", ctx: context.Background(), loader: &currentIndexMetaVaultLoaderStub{
			project: &currentIndexMetaVaultStub{regular: map[string]centrysecrets.Secret{
				currentIndexMetaStaleTimeoutKey: {Value: secret},
			}},
		}, want: ErrCurrentIndexMetaTimeoutUnavailable},
		{name: "loader failure", ctx: context.Background(), loader: &currentIndexMetaVaultLoaderStub{
			err: errors.New("vault detail " + secret),
		}, want: ErrCurrentIndexMetaTimeoutUnavailable},
		{name: "deadline", ctx: context.Background(), loader: &currentIndexMetaVaultLoaderStub{
			err: context.DeadlineExceeded,
		}, want: context.DeadlineExceeded},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			resolver, err := NewCurrentIndexMetaTimeoutResolver(test.loader)
			if err != nil {
				t.Fatal(err)
			}
			_, err = resolver.ResolveCurrentIndexMetaStaleTimeout(test.ctx, 1)
			if !errors.Is(err, test.want) || strings.Contains(err.Error(), secret) {
				t.Fatalf("ResolveCurrentIndexMetaStaleTimeout() error = %v", err)
			}
		})
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	resolver, err := NewCurrentIndexMetaTimeoutResolver(&currentIndexMetaVaultLoaderStub{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = resolver.ResolveCurrentIndexMetaStaleTimeout(ctx, 1)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled error = %v", err)
	}
}

type currentIndexMetaVaultLoaderStub struct {
	projectID int64
	project   SecretVault
	err       error
}

func (s *currentIndexMetaVaultLoaderStub) LoadProjectVault(_ context.Context, projectID int64) (SecretVault, error) {
	s.projectID = projectID
	return s.project, s.err
}

func (s *currentIndexMetaVaultLoaderStub) LoadAdminVault(context.Context) (SecretVault, error) {
	return nil, errors.New("unexpected admin vault lookup")
}

type currentIndexMetaVaultStub struct {
	regular map[string]centrysecrets.Secret
}

func (s *currentIndexMetaVaultStub) Lookup(name string) (centrysecrets.Secret, error) {
	return s.LookupRegular(name)
}

func (s *currentIndexMetaVaultStub) LookupRegular(name string) (centrysecrets.Secret, error) {
	secret, ok := s.regular[name]
	if !ok {
		return centrysecrets.Secret{}, centrysecrets.ErrSecretNotFound
	}
	return secret, nil
}

func (s *currentIndexMetaVaultStub) LookupProjectID(string) (centrysecrets.Secret, error) {
	return centrysecrets.Secret{}, centrysecrets.ErrSecretNotFound
}

func (s *currentIndexMetaVaultStub) LookupRegularProjectID(string) (centrysecrets.Secret, error) {
	return centrysecrets.Secret{}, centrysecrets.ErrSecretNotFound
}

func (s *currentIndexMetaVaultStub) LookupRegularInteger(name string) (centrysecrets.Secret, error) {
	return s.LookupRegular(name)
}

// A project that has stored no secret has no vault. That is the same answer as
// a vault without the key: the timeout was never overridden. It used to fail
// the read instead, on every fresh project.
func TestCurrentIndexMetaTimeoutReaderReadsAnAbsentVaultAsTheDefault(t *testing.T) {
	resolver, err := NewCurrentIndexMetaTimeoutResolver(&currentModelVaultLoaderStub{
		loadProject: func(context.Context, int64) (SecretVault, error) { return nil, ErrVaultAbsent },
		loadAdmin:   func(context.Context) (SecretVault, error) { return nil, ErrVaultAbsent },
	})
	if err != nil {
		t.Fatal(err)
	}
	timeout, err := resolver.ResolveCurrentIndexMetaStaleTimeout(context.Background(), 7)
	if err != nil {
		t.Fatalf("an absent vault must read as the default timeout: %v", err)
	}
	if timeout != defaultCurrentIndexMetaStaleTimeout {
		t.Fatalf("timeout=%s", timeout)
	}
}
