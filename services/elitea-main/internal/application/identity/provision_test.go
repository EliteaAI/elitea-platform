package identity

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type repositoryStub struct {
	calls   int
	command ProvisionCommand
	result  ProvisionResult
	err     error
}

func (s *repositoryStub) Provision(_ context.Context, command ProvisionCommand) (ProvisionResult, error) {
	s.calls++
	s.command = command
	return s.result, s.err
}

func TestProvisionDerivesCurrentBaselineCommand(t *testing.T) {
	tests := []struct {
		name                 string
		assertion            VerifiedAssertion
		initialGlobalAdmins  []string
		wantEmail            string
		wantName             string
		wantInitialAdminMode string
		wantInitialAdminRole string
	}{
		{
			name: "asserted email and given plus family name",
			assertion: VerifiedAssertion{
				Provider:          "oidc",
				ProviderReference: "Admin",
				Email:             "USER@Example.COM",
				GivenName:         "Ada",
				FamilyName:        "Lovelace",
				Name:              "ignored display name",
			},
			initialGlobalAdmins:  []string{"Admin"},
			wantEmail:            "user@example.com",
			wantName:             "Ada Lovelace",
			wantInitialAdminMode: initialAdministrationMode,
			wantInitialAdminRole: initialAdministrationRole,
		},
		{
			name: "fallback email and display name",
			assertion: VerifiedAssertion{
				Provider:          "saml",
				ProviderReference: "Subject-42",
				GivenName:         "ignored without family",
				Name:              "Display Name",
			},
			initialGlobalAdmins: []string{"subject-42"},
			wantEmail:           "subject-42@centry.user",
			wantName:            "Display Name",
		},
		{
			name: "email is the name when complete name is unavailable",
			assertion: VerifiedAssertion{
				Provider:          "form",
				ProviderReference: "LocalUser",
				FamilyName:        "ignored without given",
			},
			wantEmail: "localuser@centry.user",
			wantName:  "localuser@centry.user",
		},
		{
			name: "non RFC asserted email is only lowercased",
			assertion: VerifiedAssertion{
				Provider:          "oidc",
				ProviderReference: "subject",
				Email:             "LOCALLOGIN",
			},
			wantEmail: "locallogin",
			wantName:  "locallogin",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repository := &repositoryStub{result: successfulResult(42)}
			service := mustProvisionService(t, repository)

			result, err := service.Provision(context.Background(), ProvisionRequest{
				Assertion:           test.assertion,
				InitialGlobalAdmins: test.initialGlobalAdmins,
			})
			if err != nil {
				t.Fatal(err)
			}
			if result.UserID != 42 {
				t.Fatalf("user ID = %d, want 42", result.UserID)
			}
			if repository.calls != 1 {
				t.Fatalf("repository calls = %d, want 1", repository.calls)
			}

			command := repository.command
			if command.Provider != test.assertion.Provider || command.ProviderReference != test.assertion.ProviderReference {
				t.Fatalf("provider identity changed: %+v", command)
			}
			if command.Email != test.wantEmail || command.Name != test.wantName {
				t.Fatalf("derived identity = (%q, %q), want (%q, %q)", command.Email, command.Name, test.wantEmail, test.wantName)
			}
			if command.InitialAdministrationMode != test.wantInitialAdminMode || command.InitialAdministrationRole != test.wantInitialAdminRole {
				t.Fatalf("initial administration = (%q, %q), want (%q, %q)", command.InitialAdministrationMode, command.InitialAdministrationRole, test.wantInitialAdminMode, test.wantInitialAdminRole)
			}
			if command.Reconciliation != ReconciliationNewAIUser {
				t.Fatalf("reconciliation = %q, want %q", command.Reconciliation, ReconciliationNewAIUser)
			}
		})
	}
}

func TestProvisionInitialGlobalAdminMatchIsExactAndCaseSensitive(t *testing.T) {
	for _, admins := range [][]string{
		{"admin"},
		{" ADMIN "},
		{"other", "Admin"},
	} {
		repository := &repositoryStub{result: successfulResult(7)}
		service := mustProvisionService(t, repository)
		_, err := service.Provision(context.Background(), ProvisionRequest{
			Assertion: VerifiedAssertion{
				Provider:          "oidc",
				ProviderReference: "ADMIN",
			},
			InitialGlobalAdmins: admins,
		})
		if err != nil {
			t.Fatal(err)
		}
		if repository.command.InitialAdministrationMode != "" || repository.command.InitialAdministrationRole != "" {
			t.Fatalf("non-exact config %q requested initial administration: %+v", admins, repository.command)
		}
	}
}

func TestProvisionRejectsInvalidAssertionWithoutRepositoryCall(t *testing.T) {
	invalidUTF8 := string([]byte{0xff})
	tests := []struct {
		name      string
		assertion VerifiedAssertion
	}{
		{name: "missing provider", assertion: validAssertion(func(a *VerifiedAssertion) { a.Provider = "" })},
		{name: "blank provider", assertion: validAssertion(func(a *VerifiedAssertion) { a.Provider = " \t " })},
		{name: "invalid provider encoding", assertion: validAssertion(func(a *VerifiedAssertion) { a.Provider = invalidUTF8 })},
		{name: "missing provider reference", assertion: validAssertion(func(a *VerifiedAssertion) { a.ProviderReference = "" })},
		{name: "blank provider reference", assertion: validAssertion(func(a *VerifiedAssertion) { a.ProviderReference = " \t " })},
		{name: "provider reference control character", assertion: validAssertion(func(a *VerifiedAssertion) { a.ProviderReference = "subject\nother" })},
		{name: "blank asserted email", assertion: validAssertion(func(a *VerifiedAssertion) { a.Email = " \t " })},
		{name: "email whitespace", assertion: validAssertion(func(a *VerifiedAssertion) { a.Email = "user @example.com" })},
		{name: "invalid email encoding", assertion: validAssertion(func(a *VerifiedAssertion) { a.Email = invalidUTF8 })},
		{name: "blank given name", assertion: validAssertion(func(a *VerifiedAssertion) { a.GivenName = " \t " })},
		{name: "invalid family name encoding", assertion: validAssertion(func(a *VerifiedAssertion) { a.FamilyName = invalidUTF8 })},
		{name: "name control character", assertion: validAssertion(func(a *VerifiedAssertion) { a.Name = "first\rsecond" })},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repository := &repositoryStub{result: successfulResult(1)}
			service := mustProvisionService(t, repository)
			_, err := service.Provision(context.Background(), ProvisionRequest{Assertion: test.assertion})
			if !errors.Is(err, ErrInvalidAssertion) {
				t.Fatalf("error = %v, want %v", err, ErrInvalidAssertion)
			}
			if repository.calls != 0 {
				t.Fatalf("repository calls = %d, want 0", repository.calls)
			}
		})
	}
}

func TestProvisionDoesNotCallRepositoryForCanceledContext(t *testing.T) {
	for _, test := range []struct {
		name    string
		context func() context.Context
		want    error
	}{
		{
			name: "canceled",
			context: func() context.Context {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx
			},
			want: context.Canceled,
		},
		{
			name: "deadline exceeded",
			context: func() context.Context {
				ctx, cancel := context.WithDeadline(context.Background(), time.Unix(0, 0))
				defer cancel()
				return ctx
			},
			want: context.DeadlineExceeded,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			repository := &repositoryStub{result: successfulResult(1)}
			service := mustProvisionService(t, repository)
			_, err := service.Provision(test.context(), ProvisionRequest{Assertion: validAssertion(nil)})
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
			if repository.calls != 0 {
				t.Fatalf("repository calls = %d, want 0", repository.calls)
			}
		})
	}
}

func TestProvisionSanitizesRepositoryErrorsAndPreservesCancellation(t *testing.T) {
	sensitive := errors.New("database failure for user@example.com and provider-secret")
	tests := []struct {
		name    string
		repoErr error
		want    error
	}{
		{name: "dependency failure", repoErr: sensitive, want: ErrProvisioningFailed},
		{name: "canceled", repoErr: errors.Join(sensitive, context.Canceled), want: context.Canceled},
		{name: "deadline exceeded", repoErr: errors.Join(sensitive, context.DeadlineExceeded), want: context.DeadlineExceeded},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repository := &repositoryStub{err: test.repoErr}
			service := mustProvisionService(t, repository)
			_, err := service.Provision(context.Background(), ProvisionRequest{Assertion: validAssertion(nil)})
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
			if strings.Contains(err.Error(), "user@example.com") || strings.Contains(err.Error(), "provider-secret") {
				t.Fatalf("error leaked repository detail: %v", err)
			}
		})
	}
}

func TestProvisionRejectsSuspendedAndInvalidRepositoryResults(t *testing.T) {
	tests := []struct {
		name   string
		result ProvisionResult
		want   error
	}{
		{
			name: "suspended",
			result: ProvisionResult{
				UserID:    42,
				Suspended: true,
			},
			want: ErrIdentitySuspended,
		},
		{
			name: "missing user",
			result: ProvisionResult{
				ReconciliationQueued: ReconciliationNewAIUser,
			},
			want: ErrInvalidProvisioningResult,
		},
		{
			name:   "missing reconciliation receipt",
			result: ProvisionResult{UserID: 42},
			want:   ErrInvalidProvisioningResult,
		},
		{
			name: "wrong reconciliation receipt",
			result: ProvisionResult{
				UserID:               42,
				ReconciliationQueued: "different_event",
			},
			want: ErrInvalidProvisioningResult,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repository := &repositoryStub{result: test.result}
			service := mustProvisionService(t, repository)
			_, err := service.Provision(context.Background(), ProvisionRequest{Assertion: validAssertion(nil)})
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestNewProvisionServiceRequiresRepository(t *testing.T) {
	if _, err := NewProvisionService(nil); err == nil {
		t.Fatal("expected missing repository error")
	}
}

func successfulResult(userID int64) ProvisionResult {
	return ProvisionResult{
		UserID:               userID,
		ReconciliationQueued: ReconciliationNewAIUser,
	}
}

func mustProvisionService(t *testing.T, repository Repository) *ProvisionService {
	t.Helper()
	service, err := NewProvisionService(repository)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func validAssertion(mutate func(*VerifiedAssertion)) VerifiedAssertion {
	assertion := VerifiedAssertion{
		Provider:          "oidc",
		ProviderReference: "admin",
		Email:             "user@example.com",
		GivenName:         "Given",
		FamilyName:        "Family",
		Name:              "Display",
	}
	if mutate != nil {
		mutate(&assertion)
	}
	return assertion
}
