package configurations

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestCurrentSDKDataNormalizerValidatesExpandedCopyAndPersistsOriginal(t *testing.T) {
	catalog := currentMutationTestCatalog(t)
	expander := &currentSDKExpanderStub{result: map[string]any{
		"base_url":     "https://api.github.com",
		"access_token": "redeemed-only-for-validation",
	}}
	validator := &currentSDKValidatorStub{}
	fallback := &currentSDKFallbackNormalizer{}
	normalizer, err := NewCurrentSDKDataNormalizer(catalog, expander, validator, fallback)
	if err != nil {
		t.Fatal(err)
	}
	original := map[string]any{
		"base_url":     "https://api.github.com",
		"access_token": "{{secret.existing}}",
	}
	result, err := normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
		Operation: CurrentConfigurationNormalizationCreate,
		ProjectID: 7,
		AuthorID:  13,
		Type:      "github",
		Data:      original,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Complete || !reflect.DeepEqual(result.Data, original) {
		t.Fatalf("result = %#v, want original generic settings", result)
	}
	if expander.request.CurrentProjectID != 7 || expander.request.UserID == nil ||
		*expander.request.UserID != 13 || !expander.request.Unsecret {
		t.Fatalf("expansion request = %#v", expander.request)
	}
	if validator.request.ProjectID != 7 || validator.request.AuthorID != 13 || validator.request.Type != "github" ||
		validator.request.Settings["access_token"] != "redeemed-only-for-validation" {
		t.Fatalf("validation request = %#v", validator.request)
	}
	validator.request.Settings["access_token"] = "validator mutation"
	result.Data["access_token"] = "result mutation"
	if original["access_token"] != "{{secret.existing}}" ||
		expander.request.Payload["access_token"] != "{{secret.existing}}" {
		t.Fatal("generic create input aliased expansion, validation, or returned data")
	}
	if fallback.calls != 0 {
		t.Fatal("SDK create reached the local fallback")
	}
}

func TestCurrentSDKDataNormalizerMapsOnlyBusinessRejection(t *testing.T) {
	catalog := currentMutationTestCatalog(t)
	dependencyErr := errors.New("worker unavailable")
	for _, test := range []struct {
		name      string
		validator error
		wantCode  CurrentConfigurationMutationErrorCode
		wantField string
		wantError error
	}{
		{name: "business invalid", validator: ErrCurrentSDKConfigurationRejected, wantCode: CurrentConfigurationMutationInvalid, wantField: "type"},
		{name: "dependency", validator: dependencyErr, wantError: dependencyErr},
	} {
		t.Run(test.name, func(t *testing.T) {
			normalizer, err := NewCurrentSDKDataNormalizer(
				catalog,
				&currentSDKExpanderStub{result: map[string]any{"base_url": "https://api.github.com"}},
				&currentSDKValidatorStub{err: test.validator},
				nil,
			)
			if err != nil {
				t.Fatal(err)
			}
			_, err = normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
				Operation: CurrentConfigurationNormalizationCreate,
				ProjectID: 7, AuthorID: 13, Type: "github",
				Data: map[string]any{"base_url": "https://api.github.com"},
			})
			if test.wantError != nil {
				if !errors.Is(err, test.wantError) {
					t.Fatalf("error = %v, want %v", err, test.wantError)
				}
				return
			}
			assertCurrentMutationError(t, err, test.wantCode, test.wantField)
		})
	}
}

func TestCurrentSDKDataNormalizerDelegatesLocalCreateAndEveryUpdate(t *testing.T) {
	catalog := currentMutationTestCatalog(t)
	fallback := &currentSDKFallbackNormalizer{result: CurrentConfigurationNormalizationResult{
		Data: map[string]any{"delegated": true}, Complete: true,
	}}
	normalizer, err := NewCurrentSDKDataNormalizer(
		catalog,
		&currentSDKExpanderStub{},
		&currentSDKValidatorStub{},
		fallback,
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, request := range []CurrentConfigurationNormalizationRequest{
		{Operation: CurrentConfigurationNormalizationCreate, ProjectID: 7, AuthorID: 13, Type: "llm_model", Data: map[string]any{}},
		{Operation: CurrentConfigurationNormalizationUpdate, ProjectID: 7, AuthorID: 13, Type: "github", Data: map[string]any{}},
	} {
		result, err := normalizer.Normalize(context.Background(), request)
		if err != nil || !result.Complete || result.Data["delegated"] != true {
			t.Fatalf("delegated %s/%s result=%#v err=%v", request.Operation, request.Type, result, err)
		}
	}
	if fallback.calls != 2 {
		t.Fatalf("fallback calls = %d, want 2", fallback.calls)
	}
}

type currentSDKExpanderStub struct {
	request CurrentExpansionRequest
	result  map[string]any
	err     error
}

func (s *currentSDKExpanderStub) Expand(_ context.Context, request CurrentExpansionRequest) (map[string]any, error) {
	s.request = request
	return cloneCurrentJSONObject(s.result), s.err
}

type currentSDKValidatorStub struct {
	request CurrentSDKConfigurationValidationRequest
	err     error
}

func (s *currentSDKValidatorStub) ValidateCurrentSDKConfiguration(
	_ context.Context,
	request CurrentSDKConfigurationValidationRequest,
) error {
	s.request = request
	return s.err
}

type currentSDKFallbackNormalizer struct {
	calls  int
	result CurrentConfigurationNormalizationResult
	err    error
}

func (s *currentSDKFallbackNormalizer) Normalize(
	_ context.Context,
	_ CurrentConfigurationNormalizationRequest,
) (CurrentConfigurationNormalizationResult, error) {
	s.calls++
	return s.result, s.err
}
