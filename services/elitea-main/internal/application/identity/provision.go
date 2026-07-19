// Package identity coordinates authenticated identity provisioning after an
// identity provider has verified its assertion.
package identity

import (
	"context"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	fallbackEmailDomain       = "centry.user"
	initialAdministrationMode = "administration"
	initialAdministrationRole = "super_admin"
)

var (
	ErrInvalidAssertion          = errors.New("invalid verified identity assertion")
	ErrIdentitySuspended         = errors.New("authenticated identity is suspended")
	ErrProvisioningFailed        = errors.New("authenticated identity provisioning failed")
	ErrInvalidProvisioningResult = errors.New("identity repository returned an invalid provisioning result")
)

// ReconciliationKind identifies a post-login effect that the repository must
// persist in the same transaction as identity provisioning.
type ReconciliationKind string

const ReconciliationNewAIUser ReconciliationKind = "new_ai_user"

// VerifiedAssertion contains only typed claims from a successfully verified
// provider callback. ProviderReference remains the raw current-baseline value;
// it is intentionally not prefixed or otherwise namespaced in this slice.
type VerifiedAssertion struct {
	Provider          string
	ProviderReference string
	Email             string
	GivenName         string
	FamilyName        string
	Name              string
}

type ProvisionRequest struct {
	Assertion           VerifiedAssertion
	InitialGlobalAdmins []string
}

// ProvisionCommand is the complete intent for one atomic repository call.
// Empty initial-administration fields mean the exact provider reference was
// not configured as an initial global administrator.
type ProvisionCommand struct {
	Provider                  string
	ProviderReference         string
	Email                     string
	Name                      string
	InitialAdministrationMode string
	InitialAdministrationRole string
	Reconciliation            ReconciliationKind
}

type ProvisionResult struct {
	UserID               int64
	Suspended            bool
	ReconciliationQueued ReconciliationKind
}

// Repository owns the transaction that resolves or creates the user, links
// the provider, applies current-baseline group/profile/initial-admin rules, and
// durably queues command.Reconciliation. A successful result is valid only
// after all those effects commit. A suspended result must be returned without
// committing provisioning or reconciliation effects.
type Repository interface {
	Provision(ctx context.Context, command ProvisionCommand) (ProvisionResult, error)
}

type ProvisionService struct {
	repository Repository
}

func NewProvisionService(repository Repository) (*ProvisionService, error) {
	if repository == nil {
		return nil, errors.New("identity repository is required")
	}
	return &ProvisionService{repository: repository}, nil
}

func (s *ProvisionService) Provision(ctx context.Context, request ProvisionRequest) (ProvisionResult, error) {
	if err := request.Assertion.validate(); err != nil {
		return ProvisionResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return ProvisionResult{}, err
	}

	command := deriveCommand(request)
	result, err := s.repository.Provision(ctx, command)
	if err != nil {
		return ProvisionResult{}, sanitizedRepositoryError(err)
	}
	if result.Suspended {
		return ProvisionResult{}, ErrIdentitySuspended
	}
	if result.UserID <= 0 || result.ReconciliationQueued != command.Reconciliation {
		return ProvisionResult{}, ErrInvalidProvisioningResult
	}
	return result, nil
}

func (a VerifiedAssertion) validate() error {
	if !validRequiredText(a.Provider) || !validRequiredText(a.ProviderReference) {
		return ErrInvalidAssertion
	}
	// The current baseline does not require RFC email syntax. Preserve that
	// contract while rejecting whitespace-bearing input as a strict malformed-
	// claim correction at the new typed boundary.
	if !validOptionalText(a.Email) || strings.ContainsFunc(a.Email, unicode.IsSpace) {
		return ErrInvalidAssertion
	}
	if !validOptionalText(a.GivenName) || !validOptionalText(a.FamilyName) || !validOptionalText(a.Name) {
		return ErrInvalidAssertion
	}
	return nil
}

func validRequiredText(value string) bool {
	return validText(value) && strings.TrimSpace(value) != ""
}

func validOptionalText(value string) bool {
	return value == "" || validRequiredText(value)
}

func validText(value string) bool {
	return utf8.ValidString(value) && !strings.ContainsFunc(value, unicode.IsControl)
}

func deriveCommand(request ProvisionRequest) ProvisionCommand {
	assertion := request.Assertion
	email := assertion.Email
	if email == "" {
		email = assertion.ProviderReference + "@" + fallbackEmailDomain
	}
	email = strings.ToLower(email)

	name := email
	if assertion.GivenName != "" && assertion.FamilyName != "" {
		name = assertion.GivenName + " " + assertion.FamilyName
	} else if assertion.Name != "" {
		name = assertion.Name
	}

	command := ProvisionCommand{
		Provider:          assertion.Provider,
		ProviderReference: assertion.ProviderReference,
		Email:             email,
		Name:              name,
		Reconciliation:    ReconciliationNewAIUser,
	}
	for _, providerReference := range request.InitialGlobalAdmins {
		if providerReference == assertion.ProviderReference {
			command.InitialAdministrationMode = initialAdministrationMode
			command.InitialAdministrationRole = initialAdministrationRole
			break
		}
	}
	return command
}

func sanitizedRepositoryError(err error) error {
	switch {
	case errors.Is(err, context.Canceled):
		return context.Canceled
	case errors.Is(err, context.DeadlineExceeded):
		return context.DeadlineExceeded
	default:
		return ErrProvisioningFailed
	}
}
