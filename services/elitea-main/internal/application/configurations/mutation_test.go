package configurations

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestCurrentAvailableCatalogLookupReturnsDefensiveDataSchema(t *testing.T) {
	catalog := currentMutationTestCatalog(t)
	entry, ok := catalog.EntryByType("github")
	if !ok || entry.Type != "github" || entry.Section != "credentials" {
		t.Fatalf("EntryByType(github) = %#v, %t", entry, ok)
	}
	entry.ConfigSchema[0] = '['
	second, ok := catalog.EntryByType("github")
	if !ok || second.ConfigSchema[0] != '{' {
		t.Fatal("EntryByType returned catalog-owned schema bytes")
	}

	schema, ok := catalog.DataSchemaByType("github")
	if !ok {
		t.Fatal("DataSchemaByType(github) was not found")
	}
	properties, ok := schema["properties"].(map[string]any)
	if !ok || properties["access_token"] == nil {
		t.Fatalf("github data schema = %#v", schema)
	}
	delete(properties, "access_token")
	secondSchema, ok := catalog.DataSchemaByType("github")
	if !ok || secondSchema["properties"].(map[string]any)["access_token"] == nil {
		t.Fatal("DataSchemaByType returned catalog-owned state")
	}
	if _, ok := catalog.EntryByType("GitHub"); ok {
		t.Fatal("type lookup silently normalized an unknown identifier")
	}
	if _, ok := catalog.DataSchemaByType("missing"); ok {
		t.Fatal("missing type returned a data schema")
	}
}

func TestCurrentMutationCreateOwnsFieldsAndAppliesServicePromptRules(t *testing.T) {
	repository := &currentMutationRepositoryStub{store: &currentMutationStoreStub{nextID: 41}}
	service := currentMutationTestService(t, repository, nil)
	request := CurrentConfigurationCreateRequest{
		ProjectID:   7,
		AuthorID:    13,
		EliteaTitle: "Caller_Title",
		Label:       currentMutationLabel("Code assistant"),
		Type:        "service_prompt",
		Shared:      true,
		Data: map[string]any{
			"key":     "CODE_ASSISTANT",
			"prompt":  "Use current behavior.",
			"ignored": "Pydantic model extras are ignored",
		},
	}
	created, err := service.Create(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	store := repository.store
	if repository.projectID != 7 || repository.calls != 1 {
		t.Fatalf("repository scope: project=%d calls=%d", repository.projectID, repository.calls)
	}
	if got := store.inserted; got.UUID != currentMutationUUID(1) || got.ProjectID != 7 || got.EliteaTitle != "code_assistant" ||
		got.Type != "service_prompt" || got.Section != "service_prompts" || got.Source != CurrentConfigurationSourceUser ||
		got.Label == nil || *got.Label != "Code assistant" || got.StatusOK || !got.Shared || got.AuthorID == nil ||
		*got.AuthorID != 13 || got.StatusLogs != nil || len(got.Meta) != 0 {
		t.Fatalf("server-owned create fields = %#v", got)
	}
	if !reflect.DeepEqual(store.inserted.Data, map[string]any{"key": "code_assistant", "prompt": "Use current behavior."}) {
		t.Fatalf("normalized service prompt data = %#v", store.inserted.Data)
	}
	if !reflect.DeepEqual(store.callOrder, []string{"insert", "secrets", "lifecycle"}) {
		t.Fatalf("atomic call order = %v", store.callOrder)
	}
	if len(store.secretMutations) != 0 {
		t.Fatalf("service prompt secret mutations = %#v", store.secretMutations)
	}
	intent := store.intent
	if intent.ID != currentMutationUUID(2) || intent.Operation != CurrentConfigurationCreated || intent.ActorID != 13 || intent.Before != nil || intent.After == nil {
		t.Fatalf("create lifecycle intent = %#v", intent)
	}
	if intent.After.Data["key"] != "code_assistant" || intent.After.Data["ignored"] != nil {
		t.Fatalf("create lifecycle data was not sanitized = %#v", intent.After.Data)
	}
	if intent.After.StatusOK {
		t.Fatal("ordinary HTTP create bypassed the current false status default")
	}

	request.Data["prompt"] = "caller mutation"
	created.Data["prompt"] = "result mutation"
	if store.inserted.Data["prompt"] != "Use current behavior." || store.intent.After.Data["prompt"] != "Use current behavior." {
		t.Fatal("create inputs or result alias repository state")
	}
}

func TestCurrentMutationCreateAppliesProjectContextDefaultsAndCoercion(t *testing.T) {
	repository := &currentMutationRepositoryStub{store: &currentMutationStoreStub{nextID: 42}}
	service := currentMutationTestService(t, repository, nil)
	_, err := service.Create(context.Background(), CurrentConfigurationCreateRequest{
		ProjectID: 7, AuthorID: 13, EliteaTitle: "caller_context", Label: currentMutationLabel("Context"), Type: "project_context",
		Data: map[string]any{"enabled": "false", "unknown": "ignored"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if repository.store.inserted.EliteaTitle != "project_context_7" {
		t.Fatalf("project context title = %q", repository.store.inserted.EliteaTitle)
	}
	wantData := map[string]any{"content": "", "enabled": false}
	if !reflect.DeepEqual(repository.store.inserted.Data, wantData) {
		t.Fatalf("project context defaults = %#v, want %#v", repository.store.inserted.Data, wantData)
	}
}

func TestCurrentMutationRequiresExplicitNormalizerForUnportedPydanticTypes(t *testing.T) {
	repository := &currentMutationRepositoryStub{store: &currentMutationStoreStub{nextID: 1}}
	service := currentMutationTestService(t, repository, nil)
	for _, request := range []CurrentConfigurationCreateRequest{
		{
			ProjectID: 7, AuthorID: 13, EliteaTitle: "github", Label: currentMutationLabel("GitHub"), Type: "github",
			Data: map[string]any{"base_url": "https://api.github.com"},
		},
		{
			ProjectID: 7, AuthorID: 13, EliteaTitle: "model", Label: currentMutationLabel("Model"), Type: "llm_model",
			Data: map[string]any{"name": "model"},
		},
	} {
		_, err := service.Create(context.Background(), request)
		if !errors.Is(err, ErrCurrentConfigurationNormalizationRequired) {
			t.Fatalf("create %s error = %v, want normalization required", request.Type, err)
		}
		assertCurrentMutationError(t, err, CurrentConfigurationMutationNormalizationRequired, "data")
	}
	if repository.calls != 0 {
		t.Fatal("normalization-required request reached the repository")
	}
}

func TestCurrentMutationCreateExtractsRegistrySecretsBeforeAtomicCommit(t *testing.T) {
	repository := &currentMutationRepositoryStub{store: &currentMutationStoreStub{nextID: 43}}
	normalizer := &currentMutationCapturingNormalizer{}
	service := currentMutationTestService(t, repository, normalizer)
	_, err := service.Create(context.Background(), CurrentConfigurationCreateRequest{
		ProjectID: 7, AuthorID: 13, EliteaTitle: "GitHub_Main", Label: currentMutationLabel("GitHub"), Type: "github",
		Data: map[string]any{"base_url": "https://api.github.com", "access_token": "plain-token"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if normalizer.request.Operation != CurrentConfigurationNormalizationCreate || normalizer.request.ProjectID != 7 ||
		normalizer.request.AuthorID != 13 || normalizer.request.Type != "github" {
		t.Fatalf("trusted normalization request = %#v", normalizer.request)
	}
	store := repository.store
	if store.inserted.EliteaTitle != "github_main" || store.inserted.Section != "credentials" {
		t.Fatalf("normalized generic fields = %#v", store.inserted)
	}
	if store.inserted.Data["access_token"] != "{{secret.00000000000000000000000000000001}}" {
		t.Fatalf("stored data contains an unexpected token value: %#v", store.inserted.Data)
	}
	if len(store.secretMutations) != 1 || store.secretMutations[0].Field != "access_token" ||
		store.secretMutations[0].Name != "00000000000000000000000000000001" || store.secretMutations[0].Value != "plain-token" {
		t.Fatalf("secret mutations = %#v", store.secretMutations)
	}
	if store.intent.After.Data["access_token"] != "{{secret.00000000000000000000000000000001}}" {
		t.Fatalf("lifecycle snapshot contains unsanitized data: %#v", store.intent.After.Data)
	}
}

func TestCurrentMutationUpdatePreservesPresenceAndFullyReplacesData(t *testing.T) {
	oldLabel := "Old label"
	oldAuthor := int32(5)
	oldLogs := "old status"
	existing := CurrentConfiguration{
		ID: 9, UUID: currentMutationUUID(9), ProjectID: 7, Label: &oldLabel, EliteaTitle: "github_old",
		Type: "github", Section: "credentials",
		Data: map[string]any{
			"base_url":     "https://old.example",
			"username":     "old-user",
			"access_token": "{{secret.old_token}}",
		},
		Meta: map[string]any{"old": true}, Shared: false, StatusOK: false, StatusLogs: &oldLogs,
		Source: CurrentConfigurationSourceUser, AuthorID: &oldAuthor,
	}
	repository := &currentMutationRepositoryStub{store: &currentMutationStoreStub{existing: existing}}
	service := currentMutationTestService(t, repository, nil)
	newTitle := "GitHub_New"
	shared := true
	updated, err := service.Update(context.Background(), CurrentConfigurationUpdateRequest{
		ProjectID: 7, ConfigurationID: 9, AuthorID: 13,
		EliteaTitle: &newTitle,
		LabelSet:    true,
		Label:       nil,
		DataSet:     true,
		Data:        map[string]any{"base_url": "https://new.example", "access_token": "new-token"},
		MetaSet:     true,
		Meta:        map[string]any{"new": true},
		Shared:      &shared,
	})
	if err != nil {
		t.Fatal(err)
	}
	store := repository.store
	if !reflect.DeepEqual(store.callOrder, []string{"get", "replace", "secrets", "lifecycle"}) {
		t.Fatalf("update call order = %v", store.callOrder)
	}
	replacement := store.replaced
	if replacement.EliteaTitle != "GitHub_New" || replacement.Label != nil || !replacement.Shared || replacement.StatusOK ||
		replacement.StatusLogs == nil || *replacement.StatusLogs != oldLogs || !reflect.DeepEqual(replacement.Meta, map[string]any{"new": true}) {
		t.Fatalf("replacement fields = %#v", replacement)
	}
	if _, retained := replacement.Data["username"]; retained {
		t.Fatalf("data was merged rather than fully replaced: %#v", replacement.Data)
	}
	if replacement.Data["access_token"] != "{{secret.00000000000000000000000000000001}}" {
		t.Fatalf("replacement secret was not sanitized: %#v", replacement.Data)
	}
	if updated.AuthorID == nil || *updated.AuthorID != oldAuthor || updated.Source != CurrentConfigurationSourceUser || updated.Type != "github" {
		t.Fatalf("server-owned existing columns changed: %#v", updated)
	}
	intent := store.intent
	if intent.Operation != CurrentConfigurationUpdated || intent.ActorID != 13 || intent.Before == nil || intent.After == nil {
		t.Fatalf("update lifecycle intent = %#v", intent)
	}
	if intent.Before.Data["access_token"] != "{{secret.old_token}}" ||
		intent.After.Data["access_token"] != "{{secret.00000000000000000000000000000001}}" {
		t.Fatalf("update lifecycle snapshots = before %#v after %#v", intent.Before, intent.After)
	}
}

func TestCurrentMutationUpdateInjectsAndLocksServicePromptKey(t *testing.T) {
	existing := currentMutationServicePromptRow()
	repository := &currentMutationRepositoryStub{store: &currentMutationStoreStub{existing: existing}}
	service := currentMutationTestService(t, repository, nil)
	_, err := service.Update(context.Background(), CurrentConfigurationUpdateRequest{
		ProjectID: 7, ConfigurationID: 9, AuthorID: 13,
		DataSet: true, Data: map[string]any{"prompt": "Replacement prompt"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if repository.store.replaced.EliteaTitle != "code_assistant" ||
		repository.store.replaced.Data["key"] != "code_assistant" ||
		repository.store.replaced.Data["prompt"] != "Replacement prompt" {
		t.Fatalf("service prompt replacement = %#v", repository.store.replaced)
	}

	repository = &currentMutationRepositoryStub{store: &currentMutationStoreStub{existing: existing}}
	service = currentMutationTestService(t, repository, nil)
	_, err = service.Update(context.Background(), CurrentConfigurationUpdateRequest{
		ProjectID: 7, ConfigurationID: 9, AuthorID: 13,
		DataSet: true, Data: map[string]any{"key": "decision_assistant", "prompt": "Replacement prompt"},
	})
	if !errors.Is(err, ErrImmutableCurrentConfigurationField) {
		t.Fatalf("changed service prompt key error = %v", err)
	}
	assertCurrentMutationError(t, err, CurrentConfigurationMutationImmutable, "data.key")
	if repository.store.replaced.ConfigurationID != 0 || repository.store.intent.ID != "" {
		t.Fatal("immutable service prompt update mutated row or outbox")
	}
}

func TestCurrentMutationUpdateMarksHistoricalRawCleanupDataUnavailable(t *testing.T) {
	existing := CurrentConfiguration{
		ID: 9, UUID: currentMutationUUID(9), ProjectID: 7, EliteaTitle: "github", Type: "github", Section: "credentials",
		Data: map[string]any{"base_url": "https://api.github.com", "access_token": "historical-raw-token"},
		Meta: map[string]any{}, StatusOK: true, Source: CurrentConfigurationSourceUser,
	}
	repository := &currentMutationRepositoryStub{store: &currentMutationStoreStub{existing: existing}}
	service := currentMutationTestService(t, repository, currentMutationPassThroughNormalizer{})
	label := "rename only"
	_, err := service.Update(context.Background(), CurrentConfigurationUpdateRequest{
		ProjectID: 7, ConfigurationID: 9, AuthorID: 13, LabelSet: true, Label: &label,
	})
	if err != nil {
		t.Fatalf("historical raw secret update error = %v", err)
	}
	if !reflect.DeepEqual(repository.store.callOrder, []string{"get", "replace", "secrets", "lifecycle"}) {
		t.Fatalf("historical update call order = %v", repository.store.callOrder)
	}
	if repository.store.intent.Before == nil || repository.store.intent.Before.Data != nil {
		t.Fatalf("unsafe historical data entered update intent: %#v", repository.store.intent.Before)
	}
}

func TestCurrentMutationServiceRejectsPartialCatalog(t *testing.T) {
	catalog, err := LoadCurrentAvailableCatalog([]byte(currentAvailableTestSnapshot(currentDynamicRequiredMissing)))
	if err != nil {
		t.Fatal(err)
	}
	_, err = NewCurrentConfigurationMutationService(
		&currentMutationRepositoryStub{}, catalog, currentMutationPassThroughNormalizer{},
		func() (string, error) { return currentMutationUUID(1), nil },
		func() (string, error) { return strings.Repeat("1", 32), nil },
	)
	if err == nil {
		t.Fatal("partial catalog was accepted by the mutation service")
	}
}

func TestCurrentMutationDeleteUsesMinimalSanitizedSnapshotForAnyCurrentType(t *testing.T) {
	label := "Dynamic"
	existing := CurrentConfiguration{
		ID: 9, UUID: currentMutationUUID(9), ProjectID: 7, Label: &label, EliteaTitle: "dynamic",
		Type: "removed_dynamic_type", Section: "dynamic", Data: map[string]any{"token": "raw historical value"},
		Meta: map[string]any{"secret": "not copied"}, StatusOK: true, Source: CurrentConfigurationSourceUser,
	}
	repository := &currentMutationRepositoryStub{store: &currentMutationStoreStub{existing: existing}}
	service := currentMutationTestService(t, repository, nil)
	if err := service.Delete(context.Background(), CurrentConfigurationDeleteRequest{
		ProjectID: 7, ConfigurationID: 9, AuthorID: 13,
	}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(repository.store.callOrder, []string{"get", "delete", "lifecycle"}) {
		t.Fatalf("delete call order = %v", repository.store.callOrder)
	}
	intent := repository.store.intent
	if intent.Operation != CurrentConfigurationDeleted || intent.ActorID != 13 || intent.Before == nil || intent.After != nil {
		t.Fatalf("delete intent = %#v", intent)
	}
	if intent.Before.Data != nil || intent.Before.Type != existing.Type || intent.Before.UUID != existing.UUID {
		t.Fatalf("delete snapshot was not minimal/sanitized: %#v", intent.Before)
	}
}

func TestCurrentMutationDeleteRetainsSanitizedModelIdentityForLifecycleCleanup(t *testing.T) {
	existing := CurrentConfiguration{
		ID: 9, UUID: currentMutationUUID(9), ProjectID: 7, EliteaTitle: "model", Type: "llm_model", Section: "llm",
		Data: map[string]any{
			"name": "gpt", "ai_credentials": map[string]any{"private": false, "elitea_title": "open_ai"},
		},
		Meta: map[string]any{}, StatusOK: true, Source: CurrentConfigurationSourceUser,
	}
	repository := &currentMutationRepositoryStub{store: &currentMutationStoreStub{existing: existing}}
	service := currentMutationTestService(t, repository, nil)
	if err := service.Delete(context.Background(), CurrentConfigurationDeleteRequest{
		ProjectID: 7, ConfigurationID: 9, AuthorID: 13,
	}); err != nil {
		t.Fatal(err)
	}
	snapshot := repository.store.intent.Before
	if snapshot == nil || snapshot.Data == nil || snapshot.Data["name"] != "gpt" {
		t.Fatalf("model cleanup snapshot = %#v", snapshot)
	}
	credentials, ok := snapshot.Data["ai_credentials"].(map[string]any)
	if !ok || credentials["elitea_title"] != "open_ai" {
		t.Fatalf("model credential reference = %#v", snapshot.Data)
	}
}

func TestCurrentMutationDeleteOmitsHistoricalRawSecretsWithoutBlockingDeletion(t *testing.T) {
	existing := CurrentConfiguration{
		ID: 9, UUID: currentMutationUUID(9), ProjectID: 7, EliteaTitle: "github", Type: "github", Section: "credentials",
		Data: map[string]any{"base_url": "https://api.github.com", "access_token": "historical-raw-token"},
		Meta: map[string]any{}, StatusOK: false, Source: CurrentConfigurationSourceUser,
	}
	repository := &currentMutationRepositoryStub{store: &currentMutationStoreStub{existing: existing}}
	service := currentMutationTestService(t, repository, nil)
	if err := service.Delete(context.Background(), CurrentConfigurationDeleteRequest{
		ProjectID: 7, ConfigurationID: 9, AuthorID: 13,
	}); err != nil {
		t.Fatal(err)
	}
	if repository.store.intent.Before == nil || repository.store.intent.Before.Data != nil {
		t.Fatalf("unsafe historical data entered delete intent: %#v", repository.store.intent.Before)
	}
}

func TestCurrentMutationRejectsInvalidIdentityNullObjectsAndUnknownType(t *testing.T) {
	repository := &currentMutationRepositoryStub{store: &currentMutationStoreStub{}}
	service := currentMutationTestService(t, repository, currentMutationPassThroughNormalizer{})

	unknownValue := "super-secret-unknown-type"
	_, err := service.Create(context.Background(), CurrentConfigurationCreateRequest{
		ProjectID: 7, AuthorID: 13, EliteaTitle: "valid", Label: currentMutationLabel("Valid"), Type: unknownValue, Data: map[string]any{},
	})
	if !errors.Is(err, ErrUnknownCurrentConfigurationType) || strings.Contains(err.Error(), unknownValue) {
		t.Fatalf("unknown type error leaked value or lost identity: %v", err)
	}
	assertCurrentMutationError(t, err, CurrentConfigurationMutationUnknownType, "type")

	_, err = service.Update(context.Background(), CurrentConfigurationUpdateRequest{
		ProjectID: 7, ConfigurationID: 9, AuthorID: 13, DataSet: true, Data: nil,
	})
	assertCurrentMutationError(t, err, CurrentConfigurationMutationInvalid, "data")
	_, err = service.Update(context.Background(), CurrentConfigurationUpdateRequest{
		ProjectID: 7, ConfigurationID: 9, AuthorID: 13, MetaSet: true, Meta: nil,
	})
	assertCurrentMutationError(t, err, CurrentConfigurationMutationInvalid, "meta")

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = service.Create(canceled, CurrentConfigurationCreateRequest{
		ProjectID: 7, AuthorID: 13, EliteaTitle: "valid", Label: currentMutationLabel("Valid"), Type: "project_context", Data: map[string]any{},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled create error = %v", err)
	}
	if repository.calls != 0 {
		t.Fatal("rejected requests reached the repository")
	}

	repository = &currentMutationRepositoryStub{store: &currentMutationStoreStub{}}
	service = currentMutationTestService(t, repository, currentMutationPassThroughNormalizer{})
	_, err = service.Create(context.Background(), CurrentConfigurationCreateRequest{
		ProjectID: 7, AuthorID: 13, EliteaTitle: "github", Label: currentMutationLabel("GitHub"), Type: "github",
		Data: map[string]any{"base_url": "https://api.github.com", "not allowed": "secret-looking-value"},
	})
	assertCurrentMutationError(t, err, CurrentConfigurationMutationInvalid, "data")
	_, err = service.Create(context.Background(), CurrentConfigurationCreateRequest{
		ProjectID: 7, AuthorID: 13, EliteaTitle: "github", Label: currentMutationLabel("GitHub"), Type: "github",
		Data: map[string]any{"base_url": "https://api.github.com", "access_token": 42},
	})
	assertCurrentMutationError(t, err, CurrentConfigurationMutationInvalid, "data.access_token")
	if repository.calls != 0 {
		t.Fatal("schema-invalid secret fields reached the repository")
	}
}

func TestCurrentPoVDataNormalizerEnforcesSchemaDerivedLimits(t *testing.T) {
	catalog := currentMutationTestCatalog(t)
	servicePromptSchema, _ := catalog.DataSchemaByType("service_prompt")
	projectContextSchema, _ := catalog.DataSchemaByType("project_context")
	normalizer := CurrentPoVDataNormalizer{}

	result, err := normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
		Operation: CurrentConfigurationNormalizationCreate,
		Type:      "project_context", DataSchema: projectContextSchema,
		Data: map[string]any{"content": strings.Repeat("Ж", 2500), "enabled": 0},
	})
	if err != nil || !result.Complete || result.Data["enabled"] != false {
		t.Fatalf("project context boundary result=%#v err=%v", result, err)
	}
	_, err = normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
		Operation: CurrentConfigurationNormalizationCreate,
		Type:      "project_context", DataSchema: projectContextSchema,
		Data: map[string]any{"content": strings.Repeat("Ж", 2501)},
	})
	assertCurrentMutationError(t, err, CurrentConfigurationMutationInvalid, "data.content")

	_, err = normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
		Type: "service_prompt", DataSchema: servicePromptSchema,
		Data: map[string]any{"key": "not_registered", "prompt": "prompt"},
	})
	assertCurrentMutationError(t, err, CurrentConfigurationMutationInvalid, "data.key")
	_, err = normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
		Type: "service_prompt", DataSchema: servicePromptSchema,
		Data: map[string]any{"key": " code_assistant ", "prompt": "prompt"},
	})
	assertCurrentMutationError(t, err, CurrentConfigurationMutationInvalid, "data.key")

	result, err = normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
		Type: "github", DataSchema: map[string]any{}, Data: map[string]any{},
	})
	if err != nil || result.Complete {
		t.Fatalf("unported normalizer result=%#v err=%v", result, err)
	}
	result, err = normalizer.Normalize(context.Background(), CurrentConfigurationNormalizationRequest{
		Operation: CurrentConfigurationNormalizationUpdate,
		Type:      "llm_model",
		Data: map[string]any{
			"name": "model", "max_output_tokens": json.Number("32"), "context_window": "not-a-number",
		},
	})
	if err != nil || !result.Complete || result.Data["max_output_tokens"] != int64(32) || result.Data["context_window"] != int64(0) {
		t.Fatalf("current shallow update normalization result=%#v err=%v", result, err)
	}
}

type currentMutationPassThroughNormalizer struct{}

func (currentMutationPassThroughNormalizer) Normalize(
	_ context.Context,
	request CurrentConfigurationNormalizationRequest,
) (CurrentConfigurationNormalizationResult, error) {
	return CurrentConfigurationNormalizationResult{Data: cloneCurrentJSONObject(request.Data), Complete: true}, nil
}

type currentMutationCapturingNormalizer struct {
	request CurrentConfigurationNormalizationRequest
}

func (normalizer *currentMutationCapturingNormalizer) Normalize(
	_ context.Context,
	request CurrentConfigurationNormalizationRequest,
) (CurrentConfigurationNormalizationResult, error) {
	normalizer.request = request
	return CurrentConfigurationNormalizationResult{Data: cloneCurrentJSONObject(request.Data), Complete: true}, nil
}

type currentMutationRepositoryStub struct {
	store     *currentMutationStoreStub
	projectID int32
	calls     int
	err       error
}

func (s *currentMutationRepositoryStub) WithinCurrentConfigurationMutation(
	_ context.Context,
	projectID int32,
	operation func(CurrentConfigurationMutationStore) error,
) error {
	s.calls++
	s.projectID = projectID
	if s.err != nil {
		return s.err
	}
	return operation(s.store)
}

type currentMutationStoreStub struct {
	existing CurrentConfiguration
	nextID   int32

	inserted        CurrentConfigurationCreate
	replaced        CurrentConfigurationReplace
	deletedID       int32
	secretMutations []HiddenSecretMutation
	intent          CurrentConfigurationLifecycleIntent
	callOrder       []string
}

func (s *currentMutationStoreStub) GetForMutation(_ context.Context, _ int32) (CurrentConfiguration, error) {
	s.callOrder = append(s.callOrder, "get")
	return cloneCurrentConfiguration(s.existing), nil
}

func (s *currentMutationStoreStub) InsertConfiguration(
	_ context.Context,
	input CurrentConfigurationCreate,
) (CurrentConfiguration, error) {
	s.callOrder = append(s.callOrder, "insert")
	s.inserted = cloneCurrentConfigurationCreate(input)
	row := CurrentConfiguration{
		ID: s.nextID, UUID: input.UUID, ProjectID: input.ProjectID, Label: cloneCurrentString(input.Label),
		EliteaTitle: input.EliteaTitle, Type: input.Type, Section: input.Section,
		Data: cloneCurrentJSONObject(input.Data), Meta: cloneCurrentJSONObject(input.Meta), Shared: input.Shared,
		StatusOK: input.StatusOK, StatusLogs: cloneCurrentString(input.StatusLogs), Source: input.Source,
		AuthorID: cloneCurrentInt32(input.AuthorID),
	}
	return row, nil
}

func (s *currentMutationStoreStub) ReplaceConfiguration(
	_ context.Context,
	input CurrentConfigurationReplace,
) (CurrentConfiguration, error) {
	s.callOrder = append(s.callOrder, "replace")
	s.replaced = cloneCurrentConfigurationReplace(input)
	row := cloneCurrentConfiguration(s.existing)
	row.Label = cloneCurrentString(input.Label)
	row.EliteaTitle = input.EliteaTitle
	row.Data = cloneCurrentJSONObject(input.Data)
	row.Meta = cloneCurrentJSONObject(input.Meta)
	row.Shared = input.Shared
	row.StatusOK = input.StatusOK
	row.StatusLogs = cloneCurrentString(input.StatusLogs)
	return row, nil
}

func (s *currentMutationStoreStub) DeleteConfiguration(_ context.Context, configurationID int32) error {
	s.callOrder = append(s.callOrder, "delete")
	s.deletedID = configurationID
	return nil
}

func (s *currentMutationStoreStub) PutHiddenSecrets(_ context.Context, mutations []HiddenSecretMutation) error {
	s.callOrder = append(s.callOrder, "secrets")
	s.secretMutations = cloneCurrentHiddenSecretMutations(mutations)
	return nil
}

func (s *currentMutationStoreStub) AppendLifecycleIntent(
	_ context.Context,
	intent CurrentConfigurationLifecycleIntent,
) error {
	s.callOrder = append(s.callOrder, "lifecycle")
	s.intent = cloneCurrentLifecycleIntent(intent)
	return nil
}

func currentMutationTestService(
	t *testing.T,
	repository CurrentConfigurationMutationRepository,
	normalizer CurrentConfigurationDataNormalizer,
) *CurrentConfigurationMutationService {
	t.Helper()
	uuidSequence := 0
	secretSequence := 0
	service, err := NewCurrentConfigurationMutationService(
		repository,
		currentMutationTestCatalog(t),
		normalizer,
		func() (string, error) {
			uuidSequence++
			return currentMutationUUID(uuidSequence), nil
		},
		func() (string, error) {
			secretSequence++
			return strings.Repeat("0", 31) + string(rune('0'+secretSequence)), nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func currentMutationTestCatalog(t *testing.T) *CurrentAvailableCatalog {
	t.Helper()
	catalog, err := LoadPinnedCurrentAvailableCatalog()
	if err != nil {
		t.Fatal(err)
	}
	return catalog
}

func currentMutationUUID(sequence int) string {
	return "00000000-0000-4000-8000-" + strings.Repeat("0", 11) + strconvOneDigit(sequence)
}

func currentMutationLabel(value string) *string {
	return &value
}

func strconvOneDigit(value int) string {
	return string(rune('0' + value))
}

func currentMutationServicePromptRow() CurrentConfiguration {
	author := int32(5)
	return CurrentConfiguration{
		ID: 9, UUID: currentMutationUUID(9), ProjectID: 7, EliteaTitle: "code_assistant",
		Type: "service_prompt", Section: "service_prompts",
		Data: map[string]any{"key": "code_assistant", "prompt": "Original prompt"}, Meta: map[string]any{},
		StatusOK: true, Source: CurrentConfigurationSourceUser, AuthorID: &author,
	}
}

func assertCurrentMutationError(
	t *testing.T,
	err error,
	wantCode CurrentConfigurationMutationErrorCode,
	wantField string,
) {
	t.Helper()
	var mutationError *CurrentConfigurationMutationError
	if !errors.As(err, &mutationError) {
		t.Fatalf("error %v is not CurrentConfigurationMutationError", err)
	}
	if mutationError.Code != wantCode || mutationError.Field != wantField {
		t.Fatalf("mutation error = %#v, want code=%q field=%q", mutationError, wantCode, wantField)
	}
}
