package litellm

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/stretchr/testify/require"
)

type currentEffectsMaterializerFunc func(
	context.Context,
	configurationapp.CurrentConfigurationLifecycleSnapshot,
) (Configuration, error)

func (f currentEffectsMaterializerFunc) MaterializeCurrentLiteLLMConfiguration(
	ctx context.Context,
	snapshot configurationapp.CurrentConfigurationLifecycleSnapshot,
) (Configuration, error) {
	return f(ctx, snapshot)
}

type currentEffectsMasterKey struct{}

func (currentEffectsMasterKey) MasterKey(ctx context.Context) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return "test-master-key", nil
}

type currentEffectsTransport struct {
	mu sync.Mutex

	credentials []CredentialRecord
	models      []ModelRecord
	calls       []string
	deletedIDs  []string

	failCredentialCreateAfterApply bool
	failResponseSecret             string
	nextModelID                    int
}

func (t *currentEffectsTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if err := request.Context().Err(); err != nil {
		return nil, err
	}
	var body []byte
	if request.Body != nil {
		var err error
		body, err = io.ReadAll(request.Body)
		if err != nil {
			return nil, err
		}
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	t.calls = append(t.calls, request.Method+" "+request.URL.Path)

	switch {
	case request.Method == http.MethodGet && request.URL.Path == "/credentials":
		credentials := t.credentials
		if credentials == nil {
			credentials = []CredentialRecord{}
		}
		return currentEffectsResponse(http.StatusOK, map[string]any{"credentials": credentials}), nil
	case request.Method == http.MethodDelete && strings.HasPrefix(request.URL.Path, "/credentials/"):
		name := strings.TrimPrefix(request.URL.Path, "/credentials/")
		for index := range t.credentials {
			if t.credentials[index].CredentialName == name {
				t.credentials = append(t.credentials[:index], t.credentials[index+1:]...)
				break
			}
		}
		return currentEffectsResponse(http.StatusOK, map[string]any{"success": true}), nil
	case request.Method == http.MethodPost && request.URL.Path == "/credentials":
		var projection CredentialProjection
		if err := json.Unmarshal(body, &projection); err != nil {
			return nil, err
		}
		t.credentials = append(t.credentials, CredentialRecord(projection))
		if t.failCredentialCreateAfterApply {
			t.failCredentialCreateAfterApply = false
			return currentEffectsResponse(
				http.StatusBadGateway,
				map[string]any{"detail": "provider accepted request: " + t.failResponseSecret},
			), nil
		}
		return currentEffectsResponse(http.StatusOK, map[string]any{"success": true}), nil
	case request.Method == http.MethodGet && request.URL.Path == "/model/info":
		models := t.models
		if models == nil {
			models = []ModelRecord{}
		}
		return currentEffectsResponse(http.StatusOK, map[string]any{"data": models}), nil
	case request.Method == http.MethodPost && request.URL.Path == "/model/delete":
		var payload struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			return nil, err
		}
		t.deletedIDs = append(t.deletedIDs, payload.ID)
		for index := range t.models {
			modelID, _ := t.models[index].ModelInfo["id"].(string)
			if modelID == payload.ID {
				t.models = append(t.models[:index], t.models[index+1:]...)
				break
			}
		}
		return currentEffectsResponse(http.StatusOK, map[string]any{"deleted_model": payload.ID}), nil
	case request.Method == http.MethodPost && request.URL.Path == "/model/new":
		var projection ModelProjection
		if err := json.Unmarshal(body, &projection); err != nil {
			return nil, err
		}
		t.nextModelID++
		modelInfo := cloneJSONObject(projection.ModelInfo)
		modelInfo["id"] = "created-" + strconv.Itoa(t.nextModelID)
		t.models = append(t.models, ModelRecord{
			ModelName: projection.ModelName, LiteLLMParams: projection.LiteLLMParams, ModelInfo: modelInfo,
		})
		return currentEffectsResponse(http.StatusOK, map[string]any{"model_id": modelInfo["id"]}), nil
	default:
		return currentEffectsResponse(http.StatusNotFound, map[string]any{"detail": "unexpected test request"}), nil
	}
}

func currentEffectsResponse(status int, payload any) *http.Response {
	body, _ := json.Marshal(payload)
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(string(body))),
	}
}

func (t *currentEffectsTransport) snapshot() ([]CredentialRecord, []ModelRecord, []string, []string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	credentials := append([]CredentialRecord(nil), t.credentials...)
	models := append([]ModelRecord(nil), t.models...)
	calls := append([]string(nil), t.calls...)
	deletedIDs := append([]string(nil), t.deletedIDs...)
	return credentials, models, calls, deletedIDs
}

func TestCurrentConfigurationEffectsCredentialEnsureConvergesOnReplay(t *testing.T) {
	transport := &currentEffectsTransport{credentials: []CredentialRecord{{
		CredentialName:   "7_credential-uuid",
		CredentialValues: map[string]any{"api_key": "stale-secret"},
		CredentialInfo:   map[string]any{"custom_llm_provider": "OpenAI"},
	}}}
	snapshot := currentCredentialSnapshot()
	materializer := currentEffectsMaterializerFunc(func(
		ctx context.Context,
		materializedSnapshot configurationapp.CurrentConfigurationLifecycleSnapshot,
	) (Configuration, error) {
		require.NoError(t, ctx.Err())
		require.Equal(t, "{{secret.openai_key}}", materializedSnapshot.Data["api_key"])
		// A misbehaving materializer cannot mutate the durable snapshot supplied
		// by the application interface because the adapter passes an owned copy.
		materializedSnapshot.Data["api_key"] = "mutated-copy"
		return Configuration{
			UUID: snapshot.UUID, ProjectID: int64(snapshot.ProjectID), Type: snapshot.Type,
			Data: map[string]any{"api_base": "https://api.openai.test", "api_key": "expanded-secret"},
		}, nil
	})
	effects := newCurrentEffectsForTest(t, transport, materializer, nil)
	desired := currentCredentialDesired(snapshot)

	require.NoError(t, effects.EnsureCurrentLiteLLMCredential(context.Background(), desired))
	require.NoError(t, effects.EnsureCurrentLiteLLMCredential(context.Background(), desired))
	require.Equal(t, "{{secret.openai_key}}", snapshot.Data["api_key"])

	credentials, _, calls, _ := transport.snapshot()
	require.Len(t, credentials, 1)
	require.Equal(t, desired.Name, credentials[0].CredentialName)
	require.Equal(t, "expanded-secret", credentials[0].CredentialValues["api_key"])
	require.Equal(t, []string{
		"GET /credentials", "DELETE /credentials/7_credential-uuid", "POST /credentials",
		"GET /credentials", "DELETE /credentials/7_credential-uuid", "POST /credentials",
	}, calls)
}

func TestCurrentConfigurationEffectsCredentialRemovalCleansExactDuplicates(t *testing.T) {
	transport := &currentEffectsTransport{credentials: []CredentialRecord{
		{CredentialName: "7_credential-uuid"},
		{CredentialName: "8_other-uuid"},
		{CredentialName: "7_credential-uuid"},
	}}
	effects := newCurrentEffectsForTest(t, transport, currentEffectsUnusedMaterializer(t), nil)

	require.NoError(t, effects.RemoveCurrentLiteLLMCredential(
		context.Background(),
		configurationapp.CurrentLiteLLMCredentialTarget{
			EffectID: "event:remove", Revision: 1, Name: "7_credential-uuid",
			ProjectID: 7, ConfigurationUUID: "credential-uuid",
		},
	))

	credentials, _, calls, _ := transport.snapshot()
	require.Equal(t, []CredentialRecord{{CredentialName: "8_other-uuid"}}, credentials)
	require.Equal(t, []string{
		"GET /credentials",
		"DELETE /credentials/7_credential-uuid",
		"DELETE /credentials/7_credential-uuid",
	}, calls)
}

func TestCurrentConfigurationEffectsModelEnsureCleansDuplicatesAndFencesUUID(t *testing.T) {
	transport := &currentEffectsTransport{models: []ModelRecord{
		{ModelName: "7_gpt-4o", ModelInfo: map[string]any{"id": "own-1", "centry_configuration_uuid": "model-uuid"}},
		{ModelName: "7_gpt-4o", ModelInfo: map[string]any{"id": "other", "centry_configuration_uuid": "different-uuid"}},
		{ModelName: "7_gpt-4o", ModelInfo: map[string]any{"id": "unfenced"}},
		{ModelName: "8_gpt-4o", ModelInfo: map[string]any{"id": "other-project", "centry_configuration_uuid": "model-uuid"}},
		{ModelName: "7_gpt-4o", ModelInfo: map[string]any{"id": "own-2", "centry_configuration_uuid": "model-uuid"}},
	}}
	snapshot := currentModelSnapshot(true)
	materializer := currentEffectsMaterializerFunc(func(
		_ context.Context,
		_ configurationapp.CurrentConfigurationLifecycleSnapshot,
	) (Configuration, error) {
		return currentMaterializedModel(snapshot, true), nil
	})
	effects := newCurrentEffectsForTest(t, transport, materializer, map[string]any{"drop_params": true})

	require.NoError(t, effects.EnsureCurrentLiteLLMModel(context.Background(), currentModelDesired(snapshot)))

	_, models, calls, deletedIDs := transport.snapshot()
	require.Equal(t, []string{"own-1", "own-2"}, deletedIDs)
	require.Equal(t, []string{
		"GET /model/info", "POST /model/delete", "POST /model/delete", "POST /model/new",
	}, calls)
	require.Len(t, models, 4)
	require.Equal(t, "other", models[0].ModelInfo["id"])
	require.Equal(t, "unfenced", models[1].ModelInfo["id"])
	require.Equal(t, "other-project", models[2].ModelInfo["id"])
	require.Equal(t, "created-1", models[3].ModelInfo["id"])
	require.Equal(t, "model-uuid", models[3].ModelInfo["centry_configuration_uuid"])
	require.Equal(t, true, models[3].LiteLLMParams["drop_params"])
}

func TestCurrentConfigurationEffectsUnknownCreateOutcomeConvergesOnRetry(t *testing.T) {
	const secret = "expanded-provider-secret"
	transport := &currentEffectsTransport{
		failCredentialCreateAfterApply: true,
		failResponseSecret:             secret,
	}
	snapshot := currentCredentialSnapshot()
	materializer := currentEffectsMaterializerFunc(func(
		_ context.Context,
		_ configurationapp.CurrentConfigurationLifecycleSnapshot,
	) (Configuration, error) {
		return Configuration{
			UUID: snapshot.UUID, ProjectID: int64(snapshot.ProjectID), Type: snapshot.Type,
			Data: map[string]any{"api_base": "https://api.openai.test", "api_key": secret},
		}, nil
	})
	effects := newCurrentEffectsForTest(t, transport, materializer, nil)
	desired := currentCredentialDesired(snapshot)

	err := effects.EnsureCurrentLiteLLMCredential(context.Background(), desired)
	require.ErrorIs(t, err, ErrCurrentConfigurationEffectFailed)
	require.NotContains(t, err.Error(), secret)
	credentials, _, calls, _ := transport.snapshot()
	require.Len(t, credentials, 1, "the failed response is an unknown remote outcome")
	require.Equal(t, 1, countCurrentEffectsCall(calls, "POST /credentials"), "adapter must not retry internally")

	require.NoError(t, effects.EnsureCurrentLiteLLMCredential(context.Background(), desired))
	credentials, _, calls, _ = transport.snapshot()
	require.Len(t, credentials, 1)
	require.Equal(t, 2, countCurrentEffectsCall(calls, "POST /credentials"))
	require.Equal(t, 1, countCurrentEffectsCall(calls, "DELETE /credentials/7_credential-uuid"))
}

func TestCurrentConfigurationEffectsImportedModelIsNoop(t *testing.T) {
	transport := &currentEffectsTransport{}
	snapshot := currentModelSnapshot(false)
	materializer := currentEffectsMaterializerFunc(func(
		_ context.Context,
		_ configurationapp.CurrentConfigurationLifecycleSnapshot,
	) (Configuration, error) {
		return currentMaterializedModel(snapshot, false), nil
	})
	effects := newCurrentEffectsForTest(t, transport, materializer, nil)

	require.NoError(t, effects.EnsureCurrentLiteLLMModel(context.Background(), currentModelDesired(snapshot)))
	_, _, calls, _ := transport.snapshot()
	require.Empty(t, calls)
}

func TestCurrentConfigurationEffectsPreservesInFlightCancellation(t *testing.T) {
	started := make(chan struct{})
	transport := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		close(started)
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	snapshot := currentCredentialSnapshot()
	materializer := currentEffectsMaterializerFunc(func(
		_ context.Context,
		_ configurationapp.CurrentConfigurationLifecycleSnapshot,
	) (Configuration, error) {
		return Configuration{
			UUID: snapshot.UUID, ProjectID: int64(snapshot.ProjectID), Type: snapshot.Type,
			Data: map[string]any{"api_base": "https://api.openai.test", "api_key": "expanded-secret"},
		}, nil
	})
	effects := newCurrentEffectsForTest(t, transport, materializer, nil)
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		result <- effects.EnsureCurrentLiteLLMCredential(ctx, currentCredentialDesired(snapshot))
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("LiteLLM list did not start")
	}
	cancel()
	select {
	case err := <-result:
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(time.Second):
		t.Fatal("canceled lifecycle effect did not return")
	}
}

func TestCurrentConfigurationEffectsRedactsMaterializerFailure(t *testing.T) {
	const secret = "vault-provider-secret"
	transport := &currentEffectsTransport{}
	snapshot := currentCredentialSnapshot()
	materializer := currentEffectsMaterializerFunc(func(
		_ context.Context,
		_ configurationapp.CurrentConfigurationLifecycleSnapshot,
	) (Configuration, error) {
		return Configuration{}, errors.New("vault failure exposed " + secret)
	})
	effects := newCurrentEffectsForTest(t, transport, materializer, nil)

	err := effects.EnsureCurrentLiteLLMCredential(context.Background(), currentCredentialDesired(snapshot))
	require.ErrorIs(t, err, ErrCurrentConfigurationEffectFailed)
	require.NotContains(t, err.Error(), secret)
	_, _, calls, _ := transport.snapshot()
	require.Empty(t, calls)
}

func TestCurrentConfigurationEffectsRejectsInvalidConstructionAndCrossUUIDProjection(t *testing.T) {
	_, err := NewCurrentConfigurationEffects(nil, currentEffectsUnusedMaterializer(t), nil)
	require.ErrorIs(t, err, ErrInvalidCurrentConfigurationEffects)

	transport := &currentEffectsTransport{}
	snapshot := currentModelSnapshot(true)
	materializer := currentEffectsMaterializerFunc(func(
		_ context.Context,
		_ configurationapp.CurrentConfigurationLifecycleSnapshot,
	) (Configuration, error) {
		configuration := currentMaterializedModel(snapshot, true)
		configuration.UUID = "different-uuid"
		return configuration, nil
	})
	effects := newCurrentEffectsForTest(t, transport, materializer, nil)
	err = effects.EnsureCurrentLiteLLMModel(context.Background(), currentModelDesired(snapshot))
	require.ErrorIs(t, err, ErrCurrentConfigurationEffectRejected)
	_, _, calls, _ := transport.snapshot()
	require.Empty(t, calls)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func newCurrentEffectsForTest(
	t *testing.T,
	transport http.RoundTripper,
	materializer CurrentConfigurationMaterializer,
	additionalOpenAIParams map[string]any,
) *CurrentConfigurationEffects {
	t.Helper()
	client, err := NewClient(
		ClientConfig{BaseURL: "https://litellm.test"},
		currentEffectsMasterKey{},
		&http.Client{Transport: transport},
	)
	require.NoError(t, err)
	effects, err := NewCurrentConfigurationEffects(client, materializer, additionalOpenAIParams)
	require.NoError(t, err)
	return effects
}

func currentEffectsUnusedMaterializer(t *testing.T) CurrentConfigurationMaterializer {
	t.Helper()
	return currentEffectsMaterializerFunc(func(
		_ context.Context,
		_ configurationapp.CurrentConfigurationLifecycleSnapshot,
	) (Configuration, error) {
		t.Fatal("materializer must not be called")
		return Configuration{}, nil
	})
}

func currentCredentialSnapshot() configurationapp.CurrentConfigurationLifecycleSnapshot {
	return configurationapp.CurrentConfigurationLifecycleSnapshot{
		ID: 11, UUID: "credential-uuid", ProjectID: 7, Type: CredentialTypeOpenAI,
		Section: "ai_credentials", EliteaTitle: "OpenAI", Data: map[string]any{
			"api_base": "https://api.openai.test",
			"api_key":  "{{secret.openai_key}}",
		},
	}
}

func currentCredentialDesired(
	snapshot configurationapp.CurrentConfigurationLifecycleSnapshot,
) configurationapp.CurrentLiteLLMCredentialDesired {
	return configurationapp.CurrentLiteLLMCredentialDesired{
		EffectID: "event:ensure", Revision: 1, Name: "7_credential-uuid",
		ProjectID: 7, ConfigurationUUID: "credential-uuid", Configuration: snapshot,
	}
}

func currentModelSnapshot(withCredentials bool) configurationapp.CurrentConfigurationLifecycleSnapshot {
	data := map[string]any{"name": "gpt-4o"}
	if withCredentials {
		data["ai_credentials"] = map[string]any{"elitea_title": "OpenAI"}
	}
	return configurationapp.CurrentConfigurationLifecycleSnapshot{
		ID: 12, UUID: "model-uuid", ProjectID: 7, Type: "llm", Section: "llm",
		EliteaTitle: "GPT-4o", Data: data,
	}
}

func currentMaterializedModel(
	snapshot configurationapp.CurrentConfigurationLifecycleSnapshot,
	withCredentials bool,
) Configuration {
	data := map[string]any{"name": "gpt-4o"}
	if withCredentials {
		data["ai_credentials"] = map[string]any{
			"configuration_type":       CredentialTypeOpenAI,
			"configuration_uuid":       "credential-uuid",
			"configuration_project_id": int32(7),
		}
	}
	return Configuration{
		UUID: snapshot.UUID, ProjectID: int64(snapshot.ProjectID), Type: snapshot.Type, Data: data,
	}
}

func currentModelDesired(
	snapshot configurationapp.CurrentConfigurationLifecycleSnapshot,
) configurationapp.CurrentLiteLLMModelDesired {
	return configurationapp.CurrentLiteLLMModelDesired{
		EffectID: "event:ensure", Revision: 1, Name: "7_gpt-4o", ProjectID: 7,
		ConfigurationUUID: "model-uuid", Section: "llm", Configuration: snapshot,
	}
}

func countCurrentEffectsCall(calls []string, target string) int {
	count := 0
	for _, call := range calls {
		if call == target {
			count++
		}
	}
	return count
}
