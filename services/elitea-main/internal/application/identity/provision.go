// Package identity coordinates authenticated identity provisioning after an
// identity provider has verified its assertion.
package identity

import (
	"context"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

const (
	fallbackEmailDomain       = "centry.user"
	initialAdministrationMode = "administration"
	initialAdministrationRole = "super_admin"
	projectViewerRole         = "viewer"

	// These conservative bounds keep IdP-controlled writes finite. They must be
	// revalidated against sanitized identity and IdP-claim maxima before mount.
	MaxProviderBytes          = 64
	MaxProviderReferenceBytes = 768
	MaxEmailBytes             = 1024
	MaxNameClaimBytes         = 2048
)

var (
	ErrInvalidAssertion          = errors.New("invalid verified identity assertion")
	ErrIdentitySuspended         = errors.New("authenticated identity is suspended")
	ErrProvisioningFailed        = errors.New("authenticated identity provisioning failed")
	ErrInvalidProvisioningResult = errors.New("identity repository returned an invalid provisioning result")
)

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
	Assertion VerifiedAssertion
}

// ProjectEnrollmentPolicy is the current configuration consumed by the
// new_ai_user behavior on every successful browser login. AllowedDomains keeps
// the current comma-separated syntax; AdditionalGlobalAdminRoles are project
// role names, not platform roles.
type ProjectEnrollmentPolicy struct {
	ProjectID                  int32
	AllowedDomains             string
	AdditionalGlobalAdminRoles []string
}

// ProvisioningPolicy is trusted operator configuration captured at service
// construction. Provider callbacks cannot supply or override these values.
type ProvisioningPolicy struct {
	InitialGlobalAdmins []string
	ProjectEnrollment   ProjectEnrollmentPolicy
}

// ProjectEnrollmentDecision is the identity-derived part of project
// reconciliation. Global administration roles remain authoritative in the
// repository transaction and are therefore evaluated there.
type ProjectEnrollmentDecision struct {
	ProjectID                  int32
	Eligible                   bool
	AdditionalGlobalAdminRoles []string
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
	ProjectEnrollment         ProjectEnrollmentDecision
}

type ProvisionResult struct {
	UserID    int64
	Suspended bool
}

// Repository owns the transaction that resolves or creates the user, links
// the provider, applies current-baseline group/profile/initial-admin rules, and
// applies project reconciliation in that same transaction. A successful result
// is returned only after all those effects commit. A suspended result must be
// returned without committing provisioning or reconciliation effects.
type Repository interface {
	Provision(ctx context.Context, command ProvisionCommand) (ProvisionResult, error)
}

type ProvisionService struct {
	repository Repository
	policy     ProvisioningPolicy
}

func NewProvisionService(repository Repository, policy ProvisioningPolicy) (*ProvisionService, error) {
	if repository == nil {
		return nil, errors.New("identity repository is required")
	}
	policy.InitialGlobalAdmins = append([]string(nil), policy.InitialGlobalAdmins...)
	policy.ProjectEnrollment.AdditionalGlobalAdminRoles = append(
		[]string(nil),
		policy.ProjectEnrollment.AdditionalGlobalAdminRoles...,
	)
	return &ProvisionService{repository: repository, policy: policy}, nil
}

func (s *ProvisionService) Provision(ctx context.Context, request ProvisionRequest) (ProvisionResult, error) {
	if err := request.Assertion.validate(); err != nil {
		return ProvisionResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return ProvisionResult{}, err
	}

	command := deriveCommand(request.Assertion, s.policy)
	result, err := s.repository.Provision(ctx, command)
	if err != nil {
		return ProvisionResult{}, sanitizedRepositoryError(err)
	}
	if result.Suspended {
		return ProvisionResult{}, ErrIdentitySuspended
	}
	if result.UserID <= 0 {
		return ProvisionResult{}, ErrInvalidProvisioningResult
	}
	return result, nil
}

func (a VerifiedAssertion) validate() error {
	if !validRequiredText(a.Provider, MaxProviderBytes) ||
		!validRequiredText(a.ProviderReference, MaxProviderReferenceBytes) {
		return ErrInvalidAssertion
	}
	// The current baseline does not require RFC email syntax. Preserve that
	// contract while rejecting whitespace-bearing input as a strict malformed-
	// claim correction at the new typed boundary.
	if !validOptionalText(a.Email, MaxEmailBytes) || strings.ContainsFunc(a.Email, unicode.IsSpace) {
		return ErrInvalidAssertion
	}
	if !validOptionalText(a.GivenName, MaxNameClaimBytes) ||
		!validOptionalText(a.FamilyName, MaxNameClaimBytes) ||
		!validOptionalText(a.Name, MaxNameClaimBytes) {
		return ErrInvalidAssertion
	}
	return nil
}

func validRequiredText(value string, maxBytes int) bool {
	return len(value) <= maxBytes && validText(value) && strings.TrimSpace(value) != ""
}

func validOptionalText(value string, maxBytes int) bool {
	return value == "" || validRequiredText(value, maxBytes)
}

func validText(value string) bool {
	return utf8.ValidString(value) && !strings.ContainsFunc(value, unicode.IsControl)
}

func deriveCommand(assertion VerifiedAssertion, policy ProvisioningPolicy) ProvisionCommand {
	email := assertion.Email
	if email == "" {
		email = assertion.ProviderReference + "@" + fallbackEmailDomain
	}
	email = lowerLikePython(email)

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
		ProjectEnrollment: deriveProjectEnrollment(email, policy.ProjectEnrollment),
	}
	for _, providerReference := range policy.InitialGlobalAdmins {
		if providerReference == assertion.ProviderReference {
			command.InitialAdministrationMode = initialAdministrationMode
			command.InitialAdministrationRole = initialAdministrationRole
			break
		}
	}
	return command
}

func lowerLikePython(value string) string {
	// Python str.lower and Go strings.ToLower differ for Unicode special-casing
	// and contextual mappings. The pinned x/text Unicode tables are therefore a
	// cross-language readiness input and must stay covered by parity fixtures.
	return cases.Lower(language.Und).String(value)
}

func deriveProjectEnrollment(email string, policy ProjectEnrollmentPolicy) ProjectEnrollmentDecision {
	decision := ProjectEnrollmentDecision{ProjectID: policy.ProjectID}
	allowedDomains := make(map[string]struct{})
	for _, value := range strings.Split(policy.AllowedDomains, ",") {
		allowedDomains[strings.Trim(strings.TrimSpace(value), "@")] = struct{}{}
	}
	domain := email
	if separator := strings.LastIndexByte(email, '@'); separator >= 0 {
		domain = email[separator+1:]
	}
	_, wildcard := allowedDomains["*"]
	_, domainAllowed := allowedDomains[domain]
	decision.Eligible = wildcard || domainAllowed
	if !decision.Eligible {
		return decision
	}

	seen := map[string]struct{}{projectViewerRole: {}}
	decision.AdditionalGlobalAdminRoles = make([]string, 0, len(policy.AdditionalGlobalAdminRoles))
	for _, role := range policy.AdditionalGlobalAdminRoles {
		if _, duplicate := seen[role]; duplicate {
			continue
		}
		seen[role] = struct{}{}
		decision.AdditionalGlobalAdminRoles = append(decision.AdditionalGlobalAdminRoles, role)
	}
	return decision
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
