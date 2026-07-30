package configurations

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestCurrentConfigurationLifecycleEffectsReconcilerCredentialTypes(t *testing.T) {
	credentialTypes := []string{
		"open_ai", "azure_open_ai", "ai_dial", "amazon_bedrock", "vertex_ai", "ollama",
	}
	for _, credentialType := range credentialTypes {
		t.Run(credentialType, func(t *testing.T) {
			recorder := &currentLifecycleEffectsRecorder{}
			reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
			after := currentLifecycleEffectsTestSnapshot(credentialType, "ai_credentials", "Credential")
			event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)

			result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
			currentLifecycleEffectsRequireSuccess(t, result, err)
			if got, want := recorder.callSnapshot(), []string{
				"status:false", "ensure-credential:7_configuration-uuid", "status:true",
			}; !reflect.DeepEqual(got, want) {
				t.Fatalf("calls = %#v, want %#v", got, want)
			}
			if len(recorder.credentialsEnsured) != 1 {
				t.Fatalf("credentials ensured = %#v", recorder.credentialsEnsured)
			}
			desired := recorder.credentialsEnsured[0]
			if desired.EffectID != "event-1:litellm:ensure-after" || desired.Revision != 4 ||
				desired.Name != "7_configuration-uuid" || desired.ProjectID != 7 ||
				desired.ConfigurationUUID != "configuration-uuid" || desired.Configuration.Type != credentialType {
				t.Fatalf("desired credential = %#v", desired)
			}
			currentLifecycleEffectsRequireStatuses(t, recorder.statuses)
		})
	}
}

func TestCurrentConfigurationLifecycleEffectsReconcilerModelSections(t *testing.T) {
	sections := []string{
		string(CurrentModelSectionLLM),
		string(CurrentModelSectionEmbedding),
		string(CurrentModelSectionImageGeneration),
		string(CurrentModelSectionTTS),
		string(CurrentModelSectionASR),
	}
	for _, section := range sections {
		t.Run(section, func(t *testing.T) {
			recorder := &currentLifecycleEffectsRecorder{}
			reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
			after := currentLifecycleEffectsTestSnapshot(section+"_model", section, "Model")
			after.Data = currentLifecycleEffectsManagedModelData("model-a")
			event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)

			result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
			currentLifecycleEffectsRequireSuccess(t, result, err)
			if got, want := recorder.callSnapshot(), []string{
				"status:false", "ensure-model:7_model-a", "status:true",
			}; !reflect.DeepEqual(got, want) {
				t.Fatalf("calls = %#v, want %#v", got, want)
			}
			if len(recorder.modelsEnsured) != 1 {
				t.Fatalf("models ensured = %#v", recorder.modelsEnsured)
			}
			desired := recorder.modelsEnsured[0]
			if desired.Name != "7_model-a" || desired.ConfigurationUUID != "configuration-uuid" ||
				desired.Section != section || desired.Configuration.Data["secret"] != "{{secret.hidden}}" {
				t.Fatalf("desired model = %#v", desired)
			}
		})
	}
}

func TestCurrentConfigurationLifecycleEffectsReconcilerImportedModelsArePassive(t *testing.T) {
	falseValues := []struct {
		name    string
		present bool
		value   any
	}{
		{name: "missing"},
		{name: "nil", present: true},
		{name: "empty map", present: true, value: map[string]any{}},
		{name: "empty string", present: true, value: ""},
		{name: "false", present: true, value: false},
	}
	for _, test := range falseValues {
		t.Run(test.name, func(t *testing.T) {
			recorder := &currentLifecycleEffectsRecorder{}
			reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
			after := currentLifecycleEffectsTestSnapshot("llm_model", string(CurrentModelSectionLLM), "Imported")
			after.Data = map[string]any{"name": "imported"}
			if test.present {
				after.Data["ai_credentials"] = test.value
			}
			event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)

			result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
			currentLifecycleEffectsRequireSuccess(t, result, err)
			if got := recorder.callSnapshot(); len(got) != 0 {
				t.Fatalf("imported model calls = %#v", got)
			}
		})
	}
}

func TestCurrentConfigurationLifecycleEffectsReconcilerGenericSDKTypesArePassive(t *testing.T) {
	tests := []struct {
		typeName string
		section  string
	}{
		{typeName: "github", section: "credentials"},
		{typeName: "openapi", section: "credentials"},
		{typeName: "pgvector", section: string(CurrentModelSectionVectorStorage)},
		{typeName: "s3", section: "artifacts"},
		{typeName: "future_provider", section: "ai_credentials"},
	}
	for _, test := range tests {
		t.Run(test.typeName, func(t *testing.T) {
			recorder := &currentLifecycleEffectsRecorder{}
			reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
			after := currentLifecycleEffectsTestSnapshot(test.typeName, test.section, "Passive")
			event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)

			result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
			currentLifecycleEffectsRequireSuccess(t, result, err)
			if got := recorder.callSnapshot(); len(got) != 0 {
				t.Fatalf("passive configuration calls = %#v", got)
			}
		})
	}
}

func TestCurrentConfigurationLifecycleEffectsReconcilerAppliesProjectPolicy(t *testing.T) {
	t.Run("private project creation is disabled", func(t *testing.T) {
		recorder := &currentLifecycleEffectsRecorder{}
		reconciler := currentLifecycleEffectsTestReconciler(t, recorder, false, 1)
		after := currentLifecycleEffectsTestSnapshot("open_ai", "ai_credentials", "Private")
		event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)

		result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
		currentLifecycleEffectsRequireSuccess(t, result, err)
		if got, want := recorder.callSnapshot(), []string{"status:false"}; !reflect.DeepEqual(got, want) {
			t.Fatalf("calls = %#v, want %#v", got, want)
		}
	})

	t.Run("public project creation remains enabled", func(t *testing.T) {
		recorder := &currentLifecycleEffectsRecorder{}
		reconciler := currentLifecycleEffectsTestReconciler(t, recorder, false, 7)
		after := currentLifecycleEffectsTestSnapshot("open_ai", "ai_credentials", "Public")
		event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)

		result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
		currentLifecycleEffectsRequireSuccess(t, result, err)
		if got, want := recorder.callSnapshot(), []string{
			"status:false", "ensure-credential:7_configuration-uuid", "status:true",
		}; !reflect.DeepEqual(got, want) {
			t.Fatalf("calls = %#v, want %#v", got, want)
		}
	})

	t.Run("deletion is never blocked by creation policy", func(t *testing.T) {
		recorder := &currentLifecycleEffectsRecorder{}
		reconciler := currentLifecycleEffectsTestReconciler(t, recorder, false, 1)
		before := currentLifecycleEffectsTestSnapshot("open_ai", "ai_credentials", "Private")
		event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationDeleted, &before, nil)

		result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
		currentLifecycleEffectsRequireSuccess(t, result, err)
		if got, want := recorder.callSnapshot(), []string{"remove-credential:7_configuration-uuid"}; !reflect.DeepEqual(got, want) {
			t.Fatalf("calls = %#v, want %#v", got, want)
		}
	})
}

func TestCurrentConfigurationLifecycleEffectsReconcilerUpdateOrder(t *testing.T) {
	recorder := &currentLifecycleEffectsRecorder{}
	reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
	before := currentLifecycleEffectsTestSnapshot("llm_model", string(CurrentModelSectionLLM), "Before")
	before.Data = currentLifecycleEffectsManagedModelData("old-model")
	after := before
	after.EliteaTitle = "After"
	after.Data = currentLifecycleEffectsManagedModelData("new-model")
	event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationUpdated, &before, &after)

	result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
	currentLifecycleEffectsRequireSuccess(t, result, err)
	if got, want := recorder.callSnapshot(), []string{
		"status:false",
		"remove-model:7_old-model",
		"ensure-model:7_new-model",
		"rename:Before:After",
		"status:true",
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("calls = %#v, want %#v", got, want)
	}
	if len(recorder.modelsRemoved) != 1 || recorder.modelsRemoved[0].ConfigurationUUID != "configuration-uuid" ||
		recorder.modelsRemoved[0].EffectID != "event-1:litellm:remove-before" {
		t.Fatalf("removed models = %#v", recorder.modelsRemoved)
	}
	if len(recorder.renames) != 1 || recorder.renames[0].EffectID != "event-1:dependents:rename" ||
		recorder.renames[0].BeforeTitle != "Before" || recorder.renames[0].AfterTitle != "After" {
		t.Fatalf("rename effects = %#v", recorder.renames)
	}
}

func TestCurrentConfigurationLifecycleEffectsReconcilerPassiveRename(t *testing.T) {
	recorder := &currentLifecycleEffectsRecorder{}
	reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
	before := currentLifecycleEffectsTestSnapshot("github", "credentials", "Before")
	after := before
	after.EliteaTitle = "After"
	event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationUpdated, &before, &after)

	result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
	currentLifecycleEffectsRequireSuccess(t, result, err)
	if got, want := recorder.callSnapshot(), []string{"rename:Before:After"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("calls = %#v, want %#v", got, want)
	}
}

func TestCurrentConfigurationLifecycleEffectsReconcilerDeleteModelSections(t *testing.T) {
	sections := []string{
		string(CurrentModelSectionLLM),
		string(CurrentModelSectionEmbedding),
		string(CurrentModelSectionImageGeneration),
		string(CurrentModelSectionTTS),
		string(CurrentModelSectionASR),
	}
	for _, section := range sections {
		t.Run(section, func(t *testing.T) {
			recorder := &currentLifecycleEffectsRecorder{}
			reconciler := currentLifecycleEffectsTestReconciler(t, recorder, false, 1)
			before := currentLifecycleEffectsTestSnapshot(section+"_model", section, "Model")
			before.Data = currentLifecycleEffectsManagedModelData("model-a")
			event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationDeleted, &before, nil)

			result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
			currentLifecycleEffectsRequireSuccess(t, result, err)
			want := []string{"remove-model:7_model-a"}
			if section == string(CurrentModelSectionLLM) {
				want = append(want, "repair-deleted-llm:model-a")
			}
			if got := recorder.callSnapshot(); !reflect.DeepEqual(got, want) {
				t.Fatalf("calls = %#v, want %#v", got, want)
			}
			if len(recorder.modelsRemoved) != 1 || recorder.modelsRemoved[0].Name != "7_model-a" ||
				recorder.modelsRemoved[0].ConfigurationUUID != "configuration-uuid" {
				t.Fatalf("removed models = %#v", recorder.modelsRemoved)
			}
		})
	}
}

func TestCurrentConfigurationLifecycleEffectsReconcilerImportedLLMDeleteRepairsDefaults(t *testing.T) {
	recorder := &currentLifecycleEffectsRecorder{}
	reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
	before := currentLifecycleEffectsTestSnapshot("llm_model", string(CurrentModelSectionLLM), "Imported")
	before.Data = map[string]any{"name": "external-model", "ai_credentials": nil}
	event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationDeleted, &before, nil)

	result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
	currentLifecycleEffectsRequireSuccess(t, result, err)
	if got, want := recorder.callSnapshot(), []string{"repair-deleted-llm:external-model"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("calls = %#v, want %#v", got, want)
	}
	if len(recorder.deletedLLMs) != 1 || recorder.deletedLLMs[0].EffectID != "event-1:dependents:deleted-llm" {
		t.Fatalf("deleted LLM effects = %#v", recorder.deletedLLMs)
	}
}

func TestCurrentConfigurationLifecycleEffectsReconcilerUsesDeterministicEffectIDs(t *testing.T) {
	recorder := &currentLifecycleEffectsRecorder{}
	reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
	after := currentLifecycleEffectsTestSnapshot("open_ai", "ai_credentials", "Credential")
	event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)

	for range 2 {
		result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
		currentLifecycleEffectsRequireSuccess(t, result, err)
	}
	if len(recorder.credentialsEnsured) != 2 ||
		recorder.credentialsEnsured[0].EffectID != recorder.credentialsEnsured[1].EffectID ||
		len(recorder.statuses) != 4 || recorder.statuses[0].EffectID != recorder.statuses[2].EffectID ||
		recorder.statuses[1].EffectID != recorder.statuses[3].EffectID {
		t.Fatalf("credential=%#v status=%#v", recorder.credentialsEnsured, recorder.statuses)
	}
}

func TestCurrentConfigurationLifecycleEffectsReconcilerReturnsOnlySafeFailureCodes(t *testing.T) {
	secretFailure := errors.New("provider response contained token=must-not-leak")
	tests := []struct {
		name      string
		failCall  string
		build     func() (CurrentConfigurationLifecycleEvent, CurrentConfigurationLifecycleIntent)
		wantCode  string
		wantCalls []string
	}{
		{
			name: "pending status", failCall: "status:false", wantCode: currentLifecycleStatusFailedCode,
			build: func() (CurrentConfigurationLifecycleEvent, CurrentConfigurationLifecycleIntent) {
				after := currentLifecycleEffectsTestSnapshot("open_ai", "ai_credentials", "Credential")
				return currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)
			},
			wantCalls: []string{"status:false"},
		},
		{
			name: "ensure", failCall: "ensure-credential:7_configuration-uuid", wantCode: currentLifecycleLiteLLMFailedCode,
			build: func() (CurrentConfigurationLifecycleEvent, CurrentConfigurationLifecycleIntent) {
				after := currentLifecycleEffectsTestSnapshot("open_ai", "ai_credentials", "Credential")
				return currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)
			},
			wantCalls: []string{"status:false", "ensure-credential:7_configuration-uuid"},
		},
		{
			name: "remove", failCall: "remove-model:7_before", wantCode: currentLifecycleLiteLLMFailedCode,
			build: func() (CurrentConfigurationLifecycleEvent, CurrentConfigurationLifecycleIntent) {
				before := currentLifecycleEffectsTestSnapshot("llm_model", string(CurrentModelSectionLLM), "Before")
				before.Data = currentLifecycleEffectsManagedModelData("before")
				after := before
				after.Data = currentLifecycleEffectsManagedModelData("after")
				return currentLifecycleEffectsTestIntent(CurrentConfigurationUpdated, &before, &after)
			},
			wantCalls: []string{"status:false", "remove-model:7_before"},
		},
		{
			name: "rename", failCall: "rename:Before:After", wantCode: currentLifecycleRenameFailedCode,
			build: func() (CurrentConfigurationLifecycleEvent, CurrentConfigurationLifecycleIntent) {
				before := currentLifecycleEffectsTestSnapshot("github", "credentials", "Before")
				after := before
				after.EliteaTitle = "After"
				return currentLifecycleEffectsTestIntent(CurrentConfigurationUpdated, &before, &after)
			},
			wantCalls: []string{"rename:Before:After"},
		},
		{
			name: "deleted LLM", failCall: "repair-deleted-llm:external", wantCode: currentLifecycleDeletedLLMFailedCode,
			build: func() (CurrentConfigurationLifecycleEvent, CurrentConfigurationLifecycleIntent) {
				before := currentLifecycleEffectsTestSnapshot("llm_model", string(CurrentModelSectionLLM), "Imported")
				before.Data = map[string]any{"name": "external"}
				return currentLifecycleEffectsTestIntent(CurrentConfigurationDeleted, &before, nil)
			},
			wantCalls: []string{"repair-deleted-llm:external"},
		},
		{
			name: "healthy status", failCall: "status:true", wantCode: currentLifecycleStatusFailedCode,
			build: func() (CurrentConfigurationLifecycleEvent, CurrentConfigurationLifecycleIntent) {
				after := currentLifecycleEffectsTestSnapshot("open_ai", "ai_credentials", "Credential")
				return currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)
			},
			wantCalls: []string{"status:false", "ensure-credential:7_configuration-uuid", "status:true"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := &currentLifecycleEffectsRecorder{failures: map[string]error{test.failCall: secretFailure}}
			reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
			event, intent := test.build()

			result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
			if err != nil || result.Disposition != CurrentConfigurationLifecycleRetry || result.ErrorCode != test.wantCode {
				t.Fatalf("result=%#v error=%v", result, err)
			}
			if strings.Contains(result.ErrorCode, "token") || strings.Contains(result.ErrorCode, "must-not-leak") {
				t.Fatalf("unsafe result code = %q", result.ErrorCode)
			}
			if got := recorder.callSnapshot(); !reflect.DeepEqual(got, test.wantCalls) {
				t.Fatalf("calls = %#v, want %#v", got, test.wantCalls)
			}
		})
	}
}

func TestCurrentConfigurationLifecycleEffectsReconcilerPreservesCancellation(t *testing.T) {
	t.Run("caller already canceled", func(t *testing.T) {
		recorder := &currentLifecycleEffectsRecorder{}
		reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
		after := currentLifecycleEffectsTestSnapshot("open_ai", "ai_credentials", "Credential")
		event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		_, err := reconciler.ReconcileCurrentConfigurationLifecycle(ctx, event, intent)
		if !errors.Is(err, context.Canceled) || len(recorder.callSnapshot()) != 0 {
			t.Fatalf("error=%v calls=%#v", err, recorder.callSnapshot())
		}
	})

	t.Run("dependency deadline", func(t *testing.T) {
		recorder := &currentLifecycleEffectsRecorder{failures: map[string]error{
			"ensure-credential:7_configuration-uuid": fmt.Errorf("secret payload: %w", context.DeadlineExceeded),
		}}
		reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
		after := currentLifecycleEffectsTestSnapshot("open_ai", "ai_credentials", "Credential")
		event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)

		_, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
		if err != context.DeadlineExceeded || strings.Contains(err.Error(), "secret") {
			t.Fatalf("error = %v", err)
		}
	})
}

func TestCurrentConfigurationLifecycleEffectsReconcilerRejectsInvalidIntent(t *testing.T) {
	baseBefore := currentLifecycleEffectsTestSnapshot("open_ai", "ai_credentials", "Before")
	baseAfter := baseBefore
	tests := []struct {
		name   string
		mutate func(*CurrentConfigurationLifecycleEvent, *CurrentConfigurationLifecycleIntent)
	}{
		{name: "event ID mismatch", mutate: func(_ *CurrentConfigurationLifecycleEvent, intent *CurrentConfigurationLifecycleIntent) {
			intent.ID = "different"
		}},
		{name: "missing after", mutate: func(_ *CurrentConfigurationLifecycleEvent, intent *CurrentConfigurationLifecycleIntent) {
			intent.After = nil
		}},
		{name: "changed type", mutate: func(_ *CurrentConfigurationLifecycleEvent, intent *CurrentConfigurationLifecycleIntent) {
			intent.After.Type = "ollama"
		}},
		{name: "changed section", mutate: func(_ *CurrentConfigurationLifecycleEvent, intent *CurrentConfigurationLifecycleIntent) {
			intent.After.Section = "credentials"
		}},
		{name: "wrong event project", mutate: func(event *CurrentConfigurationLifecycleEvent, _ *CurrentConfigurationLifecycleIntent) {
			event.ProjectID = 99
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := &currentLifecycleEffectsRecorder{}
			reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
			before := baseBefore
			after := baseAfter
			event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationUpdated, &before, &after)
			test.mutate(&event, &intent)

			result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
			if err != nil || result.Disposition != CurrentConfigurationLifecycleDead ||
				result.ErrorCode != currentLifecycleIntentInvalidCode || len(recorder.callSnapshot()) != 0 {
				t.Fatalf("result=%#v error=%v calls=%#v", result, err, recorder.callSnapshot())
			}
		})
	}
}

func TestNewCurrentConfigurationLifecycleEffectsReconcilerValidatesDependencies(t *testing.T) {
	recorder := &currentLifecycleEffectsRecorder{}
	validPolicy := CurrentLiteLLMProjectPolicy{AllowProjectOwnLLMs: true, PublicProjectID: 1}
	tests := []struct {
		name       string
		litellm    CurrentLiteLLMConfigurationEffects
		status     CurrentConfigurationLifecycleStatusWriter
		renames    CurrentConfigurationRenameEffects
		deletedLLM CurrentDeletedLLMEffects
		policy     CurrentLiteLLMProjectPolicy
	}{
		{name: "nil LiteLLM", status: recorder, renames: recorder, deletedLLM: recorder, policy: validPolicy},
		{name: "nil status", litellm: recorder, renames: recorder, deletedLLM: recorder, policy: validPolicy},
		{name: "nil rename", litellm: recorder, status: recorder, deletedLLM: recorder, policy: validPolicy},
		{name: "nil deleted LLM", litellm: recorder, status: recorder, renames: recorder, policy: validPolicy},
		{name: "invalid public project", litellm: recorder, status: recorder, renames: recorder, deletedLLM: recorder},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NewCurrentConfigurationLifecycleEffectsReconciler(
				test.litellm, test.status, test.renames, test.deletedLLM, test.policy,
			)
			if got != nil || !errors.Is(err, ErrInvalidCurrentConfigurationLifecycleEffectsReconciler) {
				t.Fatalf("reconciler=%#v error=%v", got, err)
			}
		})
	}
}

func TestCurrentConfigurationLifecycleEffectsReconcilerSupportsConcurrentCalls(t *testing.T) {
	recorder := &currentLifecycleEffectsRecorder{}
	reconciler := currentLifecycleEffectsTestReconciler(t, recorder, true, 1)
	const count = 32
	var group sync.WaitGroup
	group.Add(count)
	for index := range count {
		go func() {
			defer group.Done()
			after := currentLifecycleEffectsTestSnapshot("open_ai", "ai_credentials", "Credential")
			after.UUID = fmt.Sprintf("configuration-%d", index)
			event, intent := currentLifecycleEffectsTestIntent(CurrentConfigurationCreated, nil, &after)
			event.EventID = fmt.Sprintf("event-%d", index)
			event.ConfigurationUUID = after.UUID
			intent.ID = event.EventID
			result, err := reconciler.ReconcileCurrentConfigurationLifecycle(context.Background(), event, intent)
			if err != nil || result.Disposition != CurrentConfigurationLifecycleReconciled {
				t.Errorf("result=%#v error=%v", result, err)
			}
		}()
	}
	group.Wait()
	if len(recorder.credentialsEnsured) != count || len(recorder.statuses) != count*2 {
		t.Fatalf("ensured=%d statuses=%d", len(recorder.credentialsEnsured), len(recorder.statuses))
	}
}

func currentLifecycleEffectsTestReconciler(
	t *testing.T,
	recorder *currentLifecycleEffectsRecorder,
	allowProjectOwnLLMs bool,
	publicProjectID int32,
) *CurrentConfigurationLifecycleEffectsReconciler {
	t.Helper()
	reconciler, err := NewCurrentConfigurationLifecycleEffectsReconciler(
		recorder,
		recorder,
		recorder,
		recorder,
		CurrentLiteLLMProjectPolicy{
			AllowProjectOwnLLMs: allowProjectOwnLLMs,
			PublicProjectID:     publicProjectID,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return reconciler
}

func currentLifecycleEffectsTestSnapshot(
	typeName string,
	section string,
	title string,
) CurrentConfigurationLifecycleSnapshot {
	authorID := int32(13)
	return CurrentConfigurationLifecycleSnapshot{
		ID: 9, UUID: "configuration-uuid", ProjectID: 7,
		EliteaTitle: title, Type: typeName, Section: section,
		StatusOK: true, Source: CurrentConfigurationSourceUser, AuthorID: &authorID,
		Data: map[string]any{},
	}
}

func currentLifecycleEffectsManagedModelData(name string) map[string]any {
	return map[string]any{
		"name": name,
		"ai_credentials": map[string]any{
			"elitea_title": "OpenAI", "private": false,
		},
		"secret": "{{secret.hidden}}",
	}
}

func currentLifecycleEffectsTestIntent(
	operation CurrentConfigurationLifecycleOperation,
	before *CurrentConfigurationLifecycleSnapshot,
	after *CurrentConfigurationLifecycleSnapshot,
) (CurrentConfigurationLifecycleEvent, CurrentConfigurationLifecycleIntent) {
	snapshot := before
	if after != nil {
		snapshot = after
	}
	event := CurrentConfigurationLifecycleEvent{
		EventID: "event-1", ProjectID: snapshot.ProjectID, ConfigurationUUID: snapshot.UUID,
		Revision: 4, Operation: operation, ActorID: 13, AttemptCount: 1,
	}
	return event, CurrentConfigurationLifecycleIntent{
		ID: event.EventID, Operation: operation, ActorID: event.ActorID, Before: before, After: after,
	}
}

func currentLifecycleEffectsRequireSuccess(
	t *testing.T,
	result CurrentConfigurationLifecycleReconcileResult,
	err error,
) {
	t.Helper()
	if err != nil || result.Disposition != CurrentConfigurationLifecycleReconciled || result.ErrorCode != "" {
		t.Fatalf("result=%#v error=%v", result, err)
	}
}

func currentLifecycleEffectsRequireStatuses(
	t *testing.T,
	statuses []CurrentConfigurationLifecycleStatusUpdate,
) {
	t.Helper()
	if len(statuses) != 2 || statuses[0].EffectID != "event-1:status:pending" || statuses[0].StatusOK ||
		statuses[0].SafeCode != currentLifecycleStatusReconcilingCode ||
		statuses[1].EffectID != "event-1:status:healthy" || !statuses[1].StatusOK ||
		statuses[1].SafeCode != currentLifecycleStatusReconciledCode {
		t.Fatalf("statuses = %#v", statuses)
	}
}

type currentLifecycleEffectsRecorder struct {
	mu sync.Mutex

	calls              []string
	failures           map[string]error
	credentialsEnsured []CurrentLiteLLMCredentialDesired
	credentialsRemoved []CurrentLiteLLMCredentialTarget
	modelsEnsured      []CurrentLiteLLMModelDesired
	modelsRemoved      []CurrentLiteLLMModelTarget
	statuses           []CurrentConfigurationLifecycleStatusUpdate
	renames            []CurrentConfigurationRenameEffect
	deletedLLMs        []CurrentDeletedLLMEffect
}

func (r *currentLifecycleEffectsRecorder) EnsureCurrentLiteLLMCredential(
	_ context.Context,
	desired CurrentLiteLLMCredentialDesired,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.credentialsEnsured = append(r.credentialsEnsured, desired)
	return r.recordLocked("ensure-credential:" + desired.Name)
}

func (r *currentLifecycleEffectsRecorder) RemoveCurrentLiteLLMCredential(
	_ context.Context,
	target CurrentLiteLLMCredentialTarget,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.credentialsRemoved = append(r.credentialsRemoved, target)
	return r.recordLocked("remove-credential:" + target.Name)
}

func (r *currentLifecycleEffectsRecorder) EnsureCurrentLiteLLMModel(
	_ context.Context,
	desired CurrentLiteLLMModelDesired,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.modelsEnsured = append(r.modelsEnsured, desired)
	return r.recordLocked("ensure-model:" + desired.Name)
}

func (r *currentLifecycleEffectsRecorder) RemoveCurrentLiteLLMModel(
	_ context.Context,
	target CurrentLiteLLMModelTarget,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.modelsRemoved = append(r.modelsRemoved, target)
	return r.recordLocked("remove-model:" + target.Name)
}

func (r *currentLifecycleEffectsRecorder) SetCurrentConfigurationLifecycleStatus(
	_ context.Context,
	update CurrentConfigurationLifecycleStatusUpdate,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.statuses = append(r.statuses, update)
	return r.recordLocked(fmt.Sprintf("status:%t", update.StatusOK))
}

func (r *currentLifecycleEffectsRecorder) RenameCurrentConfigurationReferences(
	_ context.Context,
	effect CurrentConfigurationRenameEffect,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.renames = append(r.renames, effect)
	return r.recordLocked("rename:" + effect.BeforeTitle + ":" + effect.AfterTitle)
}

func (r *currentLifecycleEffectsRecorder) RepairCurrentDeletedLLMReferences(
	_ context.Context,
	effect CurrentDeletedLLMEffect,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.deletedLLMs = append(r.deletedLLMs, effect)
	return r.recordLocked("repair-deleted-llm:" + effect.ModelName)
}

func (r *currentLifecycleEffectsRecorder) recordLocked(call string) error {
	r.calls = append(r.calls, call)
	return r.failures[call]
}

func (r *currentLifecycleEffectsRecorder) callSnapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.calls...)
}
