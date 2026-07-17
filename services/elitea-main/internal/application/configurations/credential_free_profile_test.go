package configurations

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

type credentialFreeProfileArtifact struct {
	ProfileID           string `json:"profile_id"`
	ConfigurationType   string `json:"configuration_type"`
	TopLevelFieldPolicy struct {
		AllowedNonSecretFields       []string `json:"allowed_non_secret_fields"`
		ForbiddenModelSecretFields   []string `json:"forbidden_model_secret_fields"`
		UnknownFields                string   `json:"unknown_fields"`
		ForbiddenSecretFieldPresence string   `json:"forbidden_secret_field_presence"`
	} `json:"top_level_field_policy"`
	TopLevelValuePolicy struct {
		AllowedJSONShapes   []string `json:"allowed_json_shapes"`
		ForbiddenJSONShapes []string `json:"forbidden_json_shapes"`
		MaxStringUTF8Bytes  int      `json:"max_string_utf8_bytes"`
	} `json:"top_level_value_policy"`
	ValueSemantics struct {
		Algorithm        string `json:"algorithm"`
		SDKModelModified bool   `json:"sdk_model_modified"`
	} `json:"value_semantics"`
}

type legacyParityMatrix struct {
	ProfileID string `json:"profile_id"`
	Cases     []struct {
		ID       string          `json:"id"`
		Settings json.RawMessage `json:"settings"`
		Target   struct {
			Profile struct {
				Outcome string `json:"outcome"`
				Reason  string `json:"reason"`
			} `json:"profile"`
			SDK struct {
				Invoked   bool `json:"invoked"`
				CallCount int  `json:"call_count"`
			} `json:"sdk"`
			IntentionalSecurityDifference *string `json:"intentional_security_difference"`
		} `json:"target"`
	} `json:"cases"`
}

func TestCredentialFreeProfileArtifactAndLegacyMatrixAgree(t *testing.T) {
	root := credentialFreeEvidenceRoot(t)
	var profile credentialFreeProfileArtifact
	readCredentialFreeEvidence(t, filepath.Join(root, "openapi-credential-free-profile.json"), &profile)
	if profile.ProfileID != "OPENAPI_CREDENTIAL_FREE_V1" || profile.ConfigurationType != "openapi" {
		t.Fatalf("unexpected credential-free profile identity: %+v", profile)
	}
	wantAllowed := []string{"auth_type", "client_id", "custom_header_name", "method", "scope", "token_url"}
	if !reflect.DeepEqual(profile.TopLevelFieldPolicy.AllowedNonSecretFields, wantAllowed) {
		t.Fatalf("profile allowed fields drifted: %v", profile.TopLevelFieldPolicy.AllowedNonSecretFields)
	}
	if !reflect.DeepEqual(profile.TopLevelFieldPolicy.ForbiddenModelSecretFields, []string{"api_key", "client_secret"}) || profile.TopLevelFieldPolicy.UnknownFields != "REJECT_BEFORE_SDK" {
		t.Fatalf("profile field classification drifted: %+v", profile.TopLevelFieldPolicy)
	}
	if !reflect.DeepEqual(profile.TopLevelValuePolicy.AllowedJSONShapes, []string{"BOOLEAN", "NULL", "NUMBER", "STRING"}) || !reflect.DeepEqual(profile.TopLevelValuePolicy.ForbiddenJSONShapes, []string{"ARRAY", "OBJECT"}) || profile.TopLevelValuePolicy.MaxStringUTF8Bytes != maxValidationJSONString {
		t.Fatalf("profile scalar boundary drifted: %+v", profile.TopLevelValuePolicy)
	}
	if profile.ValueSemantics.Algorithm != "OpenApiConfiguration.model_validate(settings)" || profile.ValueSemantics.SDKModelModified {
		t.Fatalf("profile no longer delegates exact value semantics to the SDK: %+v", profile.ValueSemantics)
	}

	for _, field := range profile.TopLevelFieldPolicy.AllowedNonSecretFields {
		settings, err := json.Marshal(map[string]any{field: nil})
		if err != nil {
			t.Fatal(err)
		}
		if err := validateCredentialFreeSettings(settings); err != nil {
			t.Fatalf("machine-profile allowed field %q was rejected: %v", field, err)
		}
	}
	for _, field := range profile.TopLevelFieldPolicy.ForbiddenModelSecretFields {
		settings, err := json.Marshal(map[string]any{field: nil})
		if err != nil {
			t.Fatal(err)
		}
		if err := validateCredentialFreeSettings(settings); !errors.Is(err, ErrCredentialBearingValidationInput) {
			t.Fatalf("machine-profile secret field %q was not rejected by presence: %v", field, err)
		}
	}

	var matrix legacyParityMatrix
	readCredentialFreeEvidence(t, filepath.Join(root, "openapi-legacy-parity-matrix.json"), &matrix)
	if matrix.ProfileID != profile.ProfileID {
		t.Fatalf("parity matrix profile %q differs from %q", matrix.ProfileID, profile.ProfileID)
	}
	required := map[string]bool{
		"method_lowercase_basic":                           false,
		"partial_oauth_client_id":                          false,
		"null_non_secret_fields":                           false,
		"custom_header_string_not_coerced":                 false,
		"custom_header_name_x_api_key_is_non_secret_value": false,
		"all_known_non_secret_fields":                      false,
		"nested_x_api_key_legacy_extra_bypass":             false,
		"container_canary_under_allowed_field":             false,
	}
	for _, testCase := range matrix.Cases {
		if _, exists := required[testCase.ID]; exists {
			required[testCase.ID] = true
		}
		err := validateCredentialFreeSettings(testCase.Settings)
		switch testCase.Target.Profile.Outcome {
		case "ADMIT":
			if err != nil || !testCase.Target.SDK.Invoked || testCase.Target.SDK.CallCount != 1 || testCase.Target.IntentionalSecurityDifference != nil {
				t.Fatalf("matrix admit case %q drifted: err=%v target=%+v", testCase.ID, err, testCase.Target)
			}
		case "REJECT":
			if err == nil || testCase.Target.SDK.Invoked || testCase.Target.SDK.CallCount != 0 || testCase.Target.IntentionalSecurityDifference == nil {
				t.Fatalf("matrix reject case %q drifted: err=%v target=%+v", testCase.ID, err, testCase.Target)
			}
			switch testCase.Target.Profile.Reason {
			case "SECRET_FIELD_PRESENT":
				if !errors.Is(err, ErrCredentialBearingValidationInput) {
					t.Fatalf("matrix secret case %q returned %v", testCase.ID, err)
				}
			case "UNKNOWN_TOP_LEVEL_FIELD":
				if !errors.Is(err, ErrUnknownValidationProfileField) {
					t.Fatalf("matrix unknown-field case %q returned %v", testCase.ID, err)
				}
			case "CONTAINER_VALUE":
				if !errors.Is(err, ErrValidationProfileContainerValue) {
					t.Fatalf("matrix container case %q returned %v", testCase.ID, err)
				}
			default:
				t.Fatalf("matrix case %q has unknown profile reason %q", testCase.ID, testCase.Target.Profile.Reason)
			}
		default:
			t.Fatalf("matrix case %q has unknown profile outcome %q", testCase.ID, testCase.Target.Profile.Outcome)
		}
	}
	for caseID, found := range required {
		if !found {
			t.Fatalf("required legacy parity case %q is missing", caseID)
		}
	}
}

func credentialFreeEvidenceRoot(t *testing.T) string {
	t.Helper()
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate credential-free profile test")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(source), "../../../../../testdata/proto/runtime/v1/configuration-validation"))
}

func readCredentialFreeEvidence(t *testing.T, path string, destination any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, destination); err != nil {
		t.Fatal(err)
	}
}
