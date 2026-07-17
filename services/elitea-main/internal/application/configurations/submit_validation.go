package configurations

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	configurationdomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/configurations"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

const MaxValidationSettingsBytes = 256 * 1024

const (
	maxValidationJSONDepth  = 64
	maxValidationJSONString = 64 * 1024
)

var (
	ErrInvalidValidationAdmission       = errors.New("invalid configuration validation admission")
	ErrCredentialBearingValidationInput = errors.New("credential-bearing settings are not accepted by this validation profile")
	ErrUnknownValidationProfileField    = errors.New("settings field is not allowed by the credential-free profile")
	ErrValidationProfileContainerValue  = errors.New("container value is not allowed by the credential-free profile")
	ErrValidationInputLimitExceeded     = errors.New("configuration validation input exceeds the approved structural limit")
)

type ValidationTarget struct {
	ConfigurationType      string
	CatalogRevision        string
	CatalogDigest          runtimedomain.Digest
	SchemaID               string
	SchemaRevision         string
	SchemaDigest           runtimedomain.Digest
	SettingsEntryID        string
	SettingsVersion        string
	ExpectedSettingsDigest runtimedomain.Digest
}

func (t ValidationTarget) Validate() error {
	command := configurationdomain.ValidationCommand{
		ConfigurationRevisionID: "checked-separately",
		ConfigurationType:       t.ConfigurationType,
		CatalogRevision:         t.CatalogRevision,
		CatalogDigest:           t.CatalogDigest,
		SchemaID:                t.SchemaID,
		SchemaRevision:          t.SchemaRevision,
		SchemaDigest:            t.SchemaDigest,
		SettingsEntryID:         t.SettingsEntryID,
	}
	if err := command.Validate(); err != nil || t.SettingsVersion == "" || t.ExpectedSettingsDigest.IsZero() {
		return ErrInvalidValidationAdmission
	}
	return nil
}

// ValidationTargetResolver authorizes the immutable revision and selects the
// Go-approved catalog/schema. None of those values come from the public body.
type ValidationTargetResolver interface {
	ResolveValidationTarget(ctx context.Context, identity executionapp.AdmissionIdentity, configurationRevisionID string) (ValidationTarget, error)
}

// InputBundleFactory owns the authoritative contract serialization. The
// returned manifest digest must cover its exact immutable Manifest bytes.
type InputBundleFactory interface {
	BuildValidationInput(ctx context.Context, configurationRevisionID, entryID, entryVersion string, settings []byte) (executiondomain.InputBundle, error)
}

type ValidationJobSubmitter interface {
	SubmitValidation(ctx context.Context, request executionapp.SubmitValidationRequest) (executionapp.AdmissionOutcome, error)
}

type SubmitValidationRequest struct {
	Identity                executionapp.AdmissionIdentity
	ConfigurationRevisionID string
	IdempotencyKey          string
	Settings                []byte
}

type SubmitValidationService struct {
	targets ValidationTargetResolver
	bundles InputBundleFactory
	jobs    ValidationJobSubmitter
}

func NewSubmitValidationService(targets ValidationTargetResolver, bundles InputBundleFactory, jobs ValidationJobSubmitter) (*SubmitValidationService, error) {
	if targets == nil || bundles == nil || jobs == nil {
		return nil, errors.New("validation target, bundle and job dependencies are required")
	}
	return &SubmitValidationService{targets: targets, bundles: bundles, jobs: jobs}, nil
}

func (s *SubmitValidationService) Submit(ctx context.Context, request SubmitValidationRequest) (executionapp.AdmissionOutcome, error) {
	if request.ConfigurationRevisionID == "" || request.IdempotencyKey == "" || len(request.Settings) == 0 || len(request.Settings) > MaxValidationSettingsBytes {
		return executionapp.AdmissionOutcome{}, ErrInvalidValidationAdmission
	}
	if request.Identity.TenantID == "" || request.Identity.ResourceProjectID == "" || request.Identity.ProjectionProjectID == "" || request.Identity.ActorID == "" {
		return executionapp.AdmissionOutcome{}, ErrInvalidValidationAdmission
	}
	if err := validateCredentialFreeSettings(request.Settings); err != nil {
		return executionapp.AdmissionOutcome{}, err
	}

	target, err := s.targets.ResolveValidationTarget(ctx, request.Identity, request.ConfigurationRevisionID)
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("resolve configuration validation target: %w", err)
	}
	if err := target.Validate(); err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	actualSettingsDigest := runtimedomain.SHA256(request.Settings)
	if subtle.ConstantTimeCompare(actualSettingsDigest[:], target.ExpectedSettingsDigest[:]) != 1 {
		return executionapp.AdmissionOutcome{}, ErrInvalidValidationAdmission
	}

	bundle, err := s.bundles.BuildValidationInput(
		ctx,
		request.ConfigurationRevisionID,
		target.SettingsEntryID,
		target.SettingsVersion,
		append([]byte(nil), request.Settings...),
	)
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("build immutable validation input: %w", err)
	}

	command := configurationdomain.ValidationCommand{
		ConfigurationRevisionID: request.ConfigurationRevisionID,
		ConfigurationType:       target.ConfigurationType,
		CatalogRevision:         target.CatalogRevision,
		CatalogDigest:           target.CatalogDigest,
		SchemaID:                target.SchemaID,
		SchemaRevision:          target.SchemaRevision,
		SchemaDigest:            target.SchemaDigest,
		SettingsEntryID:         target.SettingsEntryID,
	}

	return s.jobs.SubmitValidation(ctx, executionapp.SubmitValidationRequest{
		Identity:       request.Identity,
		IdempotencyKey: request.IdempotencyKey,
		InputBundle:    bundle,
		Command:        command,
	})
}

func validateCredentialFreeSettings(settings []byte) error {
	if !utf8.Valid(settings) {
		return ErrInvalidValidationAdmission
	}
	decoder := json.NewDecoder(bytes.NewReader(settings))
	decoder.UseNumber()
	first, err := decoder.Token()
	if err != nil {
		return ErrInvalidValidationAdmission
	}
	delim, ok := first.(json.Delim)
	if !ok || delim != '{' {
		return ErrInvalidValidationAdmission
	}
	if _, err := validateJSONObject(decoder, 0); err != nil {
		return err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return ErrInvalidValidationAdmission
	}
	return nil
}

func validateJSONObject(decoder *json.Decoder, depth int) (bool, error) {
	if depth > maxValidationJSONDepth {
		return false, ErrValidationInputLimitExceeded
	}
	seen := make(map[string]struct{})
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return false, ErrInvalidValidationAdmission
		}
		key, ok := keyToken.(string)
		if !ok || len(key) > maxValidationJSONString {
			if ok {
				return false, ErrValidationInputLimitExceeded
			}
			return false, ErrInvalidValidationAdmission
		}
		if _, duplicate := seen[key]; duplicate {
			return false, ErrInvalidValidationAdmission
		}
		seen[key] = struct{}{}
		if depth == 0 {
			// Presence is sufficient: null and empty model secret fields are not a
			// credential-free escape.
			if credentialFreeOpenAPISecretField(key) {
				return false, ErrCredentialBearingValidationInput
			}
			// The pinned SDK deliberately uses extra='allow'. Narrowing the public
			// top-level vocabulary is an explicit target security difference.
			if !credentialFreeOpenAPIField(key) {
				return false, fmt.Errorf("%w: %w", ErrInvalidValidationAdmission, ErrUnknownValidationProfileField)
			}
		}
		container, err := validateJSONValue(decoder, depth+1)
		if err != nil {
			return false, err
		}
		if depth == 0 && container {
			return false, fmt.Errorf("%w: %w", ErrInvalidValidationAdmission, ErrValidationProfileContainerValue)
		}
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim('}') {
		return false, ErrInvalidValidationAdmission
	}
	return len(seen) == 0, nil
}

func validateJSONValue(decoder *json.Decoder, depth int) (bool, error) {
	if depth > maxValidationJSONDepth {
		return false, ErrValidationInputLimitExceeded
	}
	token, err := decoder.Token()
	if err != nil {
		return false, ErrInvalidValidationAdmission
	}
	delim, ok := token.(json.Delim)
	if !ok {
		switch value := token.(type) {
		case nil:
			return false, nil
		case string:
			if len(value) > maxValidationJSONString {
				return false, ErrValidationInputLimitExceeded
			}
			return false, nil
		case json.Number:
			if strings.ContainsAny(value.String(), ".eE") {
				parsed, err := strconv.ParseFloat(value.String(), 64)
				if err != nil || math.IsInf(parsed, 0) || math.IsNaN(parsed) {
					return false, ErrInvalidValidationAdmission
				}
			}
			return false, nil
		default:
			return false, nil
		}
	}
	switch delim {
	case '{':
		_, err := validateJSONObject(decoder, depth)
		return true, err
	case '[':
		for decoder.More() {
			if _, err := validateJSONValue(decoder, depth+1); err != nil {
				return false, err
			}
		}
		closing, err := decoder.Token()
		if err != nil || closing != json.Delim(']') {
			return false, ErrInvalidValidationAdmission
		}
		return true, nil
	default:
		return false, ErrInvalidValidationAdmission
	}
}

func credentialFreeOpenAPISecretField(key string) bool {
	switch key {
	case "api_key", "client_secret":
		return true
	default:
		return false
	}
}

func credentialFreeOpenAPIField(key string) bool {
	switch key {
	case "auth_type", "custom_header_name", "client_id", "token_url", "scope", "method":
		return true
	default:
		return false
	}
}
