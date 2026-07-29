package configurations

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func TestCurrentArtifactsDataNormalizerCreateParity(t *testing.T) {
	tests := []struct {
		name     string
		typeName string
		data     map[string]any
		want     map[string]any
	}{
		{
			name: "S3 materializes defaults and ignores extras", typeName: "s3",
			data: map[string]any{"region_name": "", "storage_url": "", "extra": "ignored"},
			want: map[string]any{
				"access_key": nil, "secret_access_key": nil, "region_name": "",
				"use_compatible_storage": false, "storage_url": "",
			},
		},
		{
			name: "S3 coerces Pydantic boolean", typeName: "s3",
			data: map[string]any{
				"access_key": "access", "secret_access_key": "secret", "region_name": "us-east-1",
				"use_compatible_storage": "YES", "storage_url": "https://minio.example",
			},
			want: map[string]any{
				"access_key": "access", "secret_access_key": "secret", "region_name": "us-east-1",
				"use_compatible_storage": true, "storage_url": "https://minio.example",
			},
		},
		{
			name: "S3 API credentials materialize defaults and drop RPC timestamp", typeName: "s3_api_credentials",
			data: map[string]any{"access_key_id": "bad-format-is-create-valid", "user_id": json.Number("7"), "created_at": "ignored"},
			want: map[string]any{
				"access_key_id": "bad-format-is-create-valid", "secret_access_key": nil, "user_id": int64(7),
				"expires_at": nil, "permissions": []any{}, "bucket_permissions": map[string]any{}, "is_active": true,
			},
		},
		{
			name: "S3 API credentials coerce scalars and preserve declared collections", typeName: "s3_api_credentials",
			data: map[string]any{
				"access_key_id": "ELITEA000007ABCDEFGH", "secret_access_key": "secret", "user_id": "42.0",
				"expires_at": "2030-01-02T03:04:05", "permissions": []any{"read", "write"},
				"bucket_permissions": map[string]any{"docs": []any{"read"}, "images": []string{"read", "write"}},
				"is_active":          "off",
			},
			want: map[string]any{
				"access_key_id": "ELITEA000007ABCDEFGH", "secret_access_key": "secret", "user_id": int64(42),
				"expires_at": "2030-01-02T03:04:05", "permissions": []any{"read", "write"},
				"bucket_permissions": map[string]any{"docs": []any{"read"}, "images": []any{"read", "write"}},
				"is_active":          false,
			},
		},
	}

	normalizer := NewCurrentArtifactsDataNormalizer(nil)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result, err := normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
				Operation: CurrentConfigurationNormalizationCreate,
				Type:      test.typeName,
				Data:      test.data,
			})
			if err != nil {
				t.Fatal(err)
			}
			if !result.Complete || !reflect.DeepEqual(result.Data, test.want) {
				t.Fatalf("result=%#v, want %#v", result, test.want)
			}
		})
	}
}

func TestCurrentArtifactsDataNormalizerRejectsInvalidCreateData(t *testing.T) {
	validS3 := func(overrides map[string]any) map[string]any {
		data := map[string]any{"region_name": "region", "storage_url": "url"}
		for key, value := range overrides {
			data[key] = value
		}
		return data
	}
	validAPICredential := func(overrides map[string]any) map[string]any {
		data := map[string]any{"access_key_id": "access", "user_id": json.Number("7")}
		for key, value := range overrides {
			data[key] = value
		}
		return data
	}
	tests := []struct {
		name     string
		typeName string
		data     map[string]any
		field    string
	}{
		{name: "S3 region required", typeName: "s3", data: map[string]any{"storage_url": "url"}, field: "data.region_name"},
		{name: "S3 storage URL required", typeName: "s3", data: map[string]any{"region_name": "region"}, field: "data.storage_url"},
		{name: "S3 access key is not coerced", typeName: "s3", data: validS3(map[string]any{"access_key": 7}), field: "data.access_key"},
		{name: "S3 secret is not coerced", typeName: "s3", data: validS3(map[string]any{"secret_access_key": 7}), field: "data.secret_access_key"},
		{name: "S3 boolean rejects whitespace", typeName: "s3", data: validS3(map[string]any{"use_compatible_storage": " true "}), field: "data.use_compatible_storage"},
		{name: "API access key required", typeName: "s3_api_credentials", data: map[string]any{"user_id": 7}, field: "data.access_key_id"},
		{name: "API user required", typeName: "s3_api_credentials", data: map[string]any{"access_key_id": "access"}, field: "data.user_id"},
		{name: "API user rejects fraction", typeName: "s3_api_credentials", data: validAPICredential(map[string]any{"user_id": json.Number("7.5")}), field: "data.user_id"},
		{name: "API expiration is not coerced", typeName: "s3_api_credentials", data: validAPICredential(map[string]any{"expires_at": 7}), field: "data.expires_at"},
		{name: "API permissions require list", typeName: "s3_api_credentials", data: validAPICredential(map[string]any{"permissions": "read"}), field: "data.permissions"},
		{name: "API permission requires string", typeName: "s3_api_credentials", data: validAPICredential(map[string]any{"permissions": []any{"read", 7}}), field: "data.permissions"},
		{name: "API bucket permissions require object", typeName: "s3_api_credentials", data: validAPICredential(map[string]any{"bucket_permissions": []any{}}), field: "data.bucket_permissions"},
		{name: "API bucket permission requires list", typeName: "s3_api_credentials", data: validAPICredential(map[string]any{"bucket_permissions": map[string]any{"docs": "read"}}), field: "data.bucket_permissions"},
		{name: "API bucket permission requires string", typeName: "s3_api_credentials", data: validAPICredential(map[string]any{"bucket_permissions": map[string]any{"docs": []any{7}}}), field: "data.bucket_permissions"},
		{name: "API active rejects null", typeName: "s3_api_credentials", data: validAPICredential(map[string]any{"is_active": nil}), field: "data.is_active"},
	}

	normalizer := NewCurrentArtifactsDataNormalizer(nil)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result, err := normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
				Operation: CurrentConfigurationNormalizationCreate,
				Type:      test.typeName,
				Data:      test.data,
			})
			if !errors.Is(err, ErrInvalidCurrentConfigurationMutation) || result.Complete || result.Data != nil {
				t.Fatalf("result=%#v error=%v", result, err)
			}
			var fieldError *CurrentConfigurationMutationError
			if !errors.As(err, &fieldError) || fieldError.Field != test.field || fieldError.Code != CurrentConfigurationMutationInvalid {
				t.Fatalf("field error=%#v, want field %q", fieldError, test.field)
			}
		})
	}
}

func TestCurrentArtifactsDataNormalizerDelegatesNonCreateRequests(t *testing.T) {
	fallback := &currentArtifactsNormalizerFallback{}
	normalizer := NewCurrentArtifactsDataNormalizer(fallback)
	requests := []CurrentConfigurationNormalizationRequest{
		{Operation: CurrentConfigurationNormalizationUpdate, Type: "s3", Data: map[string]any{"region_name": "updated"}},
		{Operation: CurrentConfigurationNormalizationCreate, Type: "open_ai", Data: map[string]any{"api_base": "url"}},
	}
	for _, request := range requests {
		result, err := normalizer.Normalize(context.Background(), request)
		if err != nil || !result.Complete || result.Data["delegated"] != true {
			t.Fatalf("delegated result=%#v error=%v", result, err)
		}
	}
	if !reflect.DeepEqual(fallback.requests, requests) {
		t.Fatalf("fallback requests=%#v, want %#v", fallback.requests, requests)
	}

	result, err := NewCurrentArtifactsDataNormalizer(nil).Normalize(context.Background(), requests[1])
	if err != nil || result.Complete || result.Data != nil {
		t.Fatalf("unhandled result=%#v error=%v", result, err)
	}
}

func TestCurrentArtifactsDataNormalizerHonorsContext(t *testing.T) {
	normalizer := NewCurrentArtifactsDataNormalizer(nil)
	if _, err := normalizer.Normalize(nil, CurrentConfigurationNormalizationRequest{}); !errors.Is(err, ErrInvalidCurrentConfigurationMutation) {
		t.Fatalf("nil context error=%v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := normalizer.Normalize(ctx, CurrentConfigurationNormalizationRequest{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled context error=%v", err)
	}
}

type currentArtifactsNormalizerFallback struct {
	requests []CurrentConfigurationNormalizationRequest
}

func (f *currentArtifactsNormalizerFallback) Normalize(
	_ context.Context,
	request CurrentConfigurationNormalizationRequest,
) (CurrentConfigurationNormalizationResult, error) {
	f.requests = append(f.requests, request)
	return CurrentConfigurationNormalizationResult{Data: map[string]any{"delegated": true}, Complete: true}, nil
}
