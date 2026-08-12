package runtimecomposition

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
)

func TestCurrentLiteLLMConfigurationMaterializerUsesOwningVaultThenGenericExpansion(t *testing.T) {
	callOrder := []string{}
	unsecreter := currentLifecycleUnsecreterStub{unsecret: func(
		_ context.Context,
		projectID int32,
		data map[string]any,
	) (map[string]any, error) {
		callOrder = append(callOrder, "unsecret")
		if projectID != 7 || data["api_key"] != "{{secret.key}}" {
			t.Fatalf("project=%d data=%#v", projectID, data)
		}
		return map[string]any{
			"api_key": "resolved-root",
			"ai_credentials": map[string]any{
				"elitea_title": "shared-openai", "private": false,
			},
		}, nil
	}}
	expander := currentLifecycleExpanderStub{expand: func(
		_ context.Context,
		request configurationapp.CurrentExpansionRequest,
	) (map[string]any, error) {
		callOrder = append(callOrder, "expand")
		if request.CurrentProjectID != 7 || !request.Unsecret || request.UserID == nil || *request.UserID != 13 ||
			request.Payload["api_key"] != "resolved-root" {
			t.Fatalf("request=%#v", request)
		}
		return map[string]any{
			"api_key": "resolved-root",
			"ai_credentials": map[string]any{
				"configuration_uuid":       "credential-uuid",
				"configuration_project_id": 1,
				"configuration_type":       "open_ai",
				"api_key":                  "resolved-nested",
			},
		}, nil
	}}
	materializer, err := newCurrentLiteLLMConfigurationMaterializer(expander, unsecreter)
	if err != nil {
		t.Fatal(err)
	}
	authorID := int32(13)
	snapshot := configurationapp.CurrentConfigurationLifecycleSnapshot{
		UUID: "model-uuid", ProjectID: 7, Type: "llm_model", AuthorID: &authorID,
		Data: map[string]any{
			"api_key": "{{secret.key}}",
			"ai_credentials": map[string]any{
				"elitea_title": "shared-openai", "private": false,
			},
		},
	}
	configuration, err := materializer.MaterializeCurrentLiteLLMConfiguration(context.Background(), snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if configuration.UUID != snapshot.UUID || configuration.ProjectID != 7 || configuration.Type != snapshot.Type ||
		configuration.Data["api_key"] != "resolved-root" ||
		!reflect.DeepEqual(callOrder, []string{"unsecret", "expand"}) {
		t.Fatalf("configuration=%#v calls=%#v", configuration, callOrder)
	}
	if snapshot.Data["api_key"] != "{{secret.key}}" {
		t.Fatalf("snapshot was mutated: %#v", snapshot.Data)
	}
}

func TestCurrentLiteLLMConfigurationMaterializerRedactsDependenciesAndPreservesCancellation(t *testing.T) {
	secret := "provider-token-must-not-escape"
	for name, test := range map[string]struct {
		ctx        context.Context
		expander   currentConfigurationLifecycleExpander
		unsecreter currentConfigurationLifecycleUnsecreter
		want       error
	}{
		"unsecret failure": {
			ctx: context.Background(),
			expander: currentLifecycleExpanderStub{expand: func(context.Context, configurationapp.CurrentExpansionRequest) (map[string]any, error) {
				return map[string]any{}, nil
			}},
			unsecreter: currentLifecycleUnsecreterStub{unsecret: func(context.Context, int32, map[string]any) (map[string]any, error) {
				return nil, errors.New(secret)
			}},
			want: errCurrentLiteLLMConfigurationMaterialization,
		},
		"expansion failure": {
			ctx: context.Background(),
			expander: currentLifecycleExpanderStub{expand: func(context.Context, configurationapp.CurrentExpansionRequest) (map[string]any, error) {
				return nil, errors.New(secret)
			}},
			unsecreter: currentLifecycleUnsecreterStub{unsecret: func(_ context.Context, _ int32, input map[string]any) (map[string]any, error) {
				return input, nil
			}},
			want: errCurrentLiteLLMConfigurationMaterialization,
		},
		"dependency cancellation": {
			ctx: context.Background(),
			expander: currentLifecycleExpanderStub{expand: func(context.Context, configurationapp.CurrentExpansionRequest) (map[string]any, error) {
				return nil, context.DeadlineExceeded
			}},
			unsecreter: currentLifecycleUnsecreterStub{unsecret: func(_ context.Context, _ int32, input map[string]any) (map[string]any, error) {
				return input, nil
			}},
			want: context.DeadlineExceeded,
		},
	} {
		t.Run(name, func(t *testing.T) {
			materializer, err := newCurrentLiteLLMConfigurationMaterializer(test.expander, test.unsecreter)
			if err != nil {
				t.Fatal(err)
			}
			_, err = materializer.MaterializeCurrentLiteLLMConfiguration(test.ctx, configurationapp.CurrentConfigurationLifecycleSnapshot{
				UUID: "uuid", ProjectID: 7, Type: "open_ai", Data: map[string]any{},
			})
			if !errors.Is(err, test.want) || (err != nil && strings.Contains(err.Error(), secret)) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
		})
	}
}

func TestCurrentLiteLLMConfigurationMaterializerRejectsIncompleteGraphAndSnapshot(t *testing.T) {
	validExpander := currentLifecycleExpanderStub{expand: func(context.Context, configurationapp.CurrentExpansionRequest) (map[string]any, error) {
		return map[string]any{}, nil
	}}
	validUnsecreter := currentLifecycleUnsecreterStub{unsecret: func(_ context.Context, _ int32, input map[string]any) (map[string]any, error) {
		return input, nil
	}}
	if materializer, err := newCurrentLiteLLMConfigurationMaterializer(nil, validUnsecreter); err == nil || materializer != nil {
		t.Fatalf("materializer=%#v error=%v", materializer, err)
	}
	if materializer, err := newCurrentLiteLLMConfigurationMaterializer(validExpander, nil); err == nil || materializer != nil {
		t.Fatalf("materializer=%#v error=%v", materializer, err)
	}
	materializer, err := newCurrentLiteLLMConfigurationMaterializer(validExpander, validUnsecreter)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := materializer.MaterializeCurrentLiteLLMConfiguration(context.Background(), configurationapp.CurrentConfigurationLifecycleSnapshot{}); !errors.Is(err, errCurrentLiteLLMConfigurationMaterialization) {
		t.Fatalf("error=%v", err)
	}
}

type currentLifecycleExpanderStub struct {
	expand func(context.Context, configurationapp.CurrentExpansionRequest) (map[string]any, error)
}

func (stub currentLifecycleExpanderStub) Expand(
	ctx context.Context,
	request configurationapp.CurrentExpansionRequest,
) (map[string]any, error) {
	return stub.expand(ctx, request)
}

type currentLifecycleUnsecreterStub struct {
	unsecret func(context.Context, int32, map[string]any) (map[string]any, error)
}

func (stub currentLifecycleUnsecreterStub) Unsecret(
	ctx context.Context,
	projectID int32,
	data map[string]any,
) (map[string]any, error) {
	return stub.unsecret(ctx, projectID, data)
}
