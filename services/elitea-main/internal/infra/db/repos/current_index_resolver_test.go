package repos

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/jackc/pgx/v5"
)

func TestCurrentIndexResolverRepositoryReadsOnlyRequestedProject(t *testing.T) {
	name := "Git Hub.One"
	settings := []byte(`{"selected_tools":["index_data"]}`)
	store := &scriptedProjectStore{scriptedExecutor: &scriptedExecutor{
		rowResults: []scriptedRow{{values: []any{int32(41), &name, "github", settings}}},
	}}
	repository, err := newCurrentIndexResolverRepository(store)
	if err != nil {
		t.Fatal(err)
	}

	record, err := repository.LoadIndexToolkit(context.Background(), 2, 41)
	if err != nil {
		t.Fatal(err)
	}
	if store.projectID != 2 || record.ID != 41 || record.Name != name || record.Type != "github" || string(record.Settings) != string(settings) {
		t.Fatalf("unexpected tenant toolkit read: project=%d record=%+v", store.projectID, record)
	}
	settings[0] = 'X'
	if record.Settings[0] == 'X' {
		t.Fatal("repository result aliases the database scan buffer")
	}
	if len(store.rowCalls) != 1 || len(store.rowCalls[0].args) != 1 || store.rowCalls[0].args[0] != int32(41) {
		t.Fatalf("unexpected SQLC call: %+v", store.rowCalls)
	}
	if !strings.Contains(store.rowCalls[0].sql, "FROM elitea_tools") {
		t.Fatalf("unexpected toolkit query: %s", store.rowCalls[0].sql)
	}
}

func TestCurrentIndexResolverRepositoryMapsConfigurationAndModelRows(t *testing.T) {
	configurationData := []byte(`{"connection_string":"{{secret.PGVECTOR_DSN}}"}`)
	store := &scriptedProjectStore{scriptedExecutor: &scriptedExecutor{
		rowResults: []scriptedRow{
			{values: []any{"00000000-0000-0000-0000-000000000003", int32(1), "pgvector", configurationData, true, false}},
			{values: []any{true}},
			{values: []any{int32(1), true, "gpt-shared", true, true, int32(8192)}},
		},
	}}
	repository, err := newCurrentIndexResolverRepository(store)
	if err != nil {
		t.Fatal(err)
	}

	configuration, err := repository.LoadSharedIndexConfiguration(context.Background(), 1, "pgvector-public")
	if err != nil {
		t.Fatal(err)
	}
	if configuration.ProjectID != 1 || configuration.Type != "pgvector" || !configuration.Shared || configuration.StatusOK || string(configuration.Data) != string(configurationData) {
		t.Fatalf("unexpected configuration row: %+v", configuration)
	}
	exists, err := repository.SharedIndexEmbeddingModelExists(context.Background(), 1, "embedding-small")
	if err != nil || !exists {
		t.Fatalf("shared embedding visibility=%t err=%v", exists, err)
	}
	model, err := repository.LoadSharedIndexLLMModel(context.Background(), 1, "gpt-shared")
	if err != nil {
		t.Fatal(err)
	}
	if model.ProjectID != 1 || model.Name != "gpt-shared" || !model.Shared || !model.SupportsReasoning || !model.OpenAICompatible || model.MaxOutputTokens != 8192 {
		t.Fatalf("unexpected LLM model row: %+v", model)
	}
	for index, call := range store.rowCalls {
		if index == 0 {
			if call.args[0] != "pgvector-public" {
				t.Fatalf("configuration title argument=%v", call.args)
			}
			continue
		}
		if call.args[0] != int32(1) {
			t.Fatalf("query %d project argument=%v", index, call.args)
		}
	}
}

func TestCurrentIndexResolverRepositoryMapsNoRowsAndRejectsInvalidIDs(t *testing.T) {
	store := &scriptedProjectStore{scriptedExecutor: &scriptedExecutor{
		rowResults: []scriptedRow{{err: pgx.ErrNoRows}},
	}}
	repository, err := newCurrentIndexResolverRepository(store)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := repository.LoadIndexToolkit(context.Background(), 2, 41); !errors.Is(err, indexingapp.ErrIndexResolverRecordNotFound) {
		t.Fatalf("no-row error=%v", err)
	}
	if _, err := repository.LoadIndexToolkit(context.Background(), 2, math.MaxInt32+1); !errors.Is(err, indexingapp.ErrIndexResolverRecordNotFound) {
		t.Fatalf("oversized toolkit ID error=%v", err)
	}
	if _, err := repository.LoadIndexConfiguration(context.Background(), 0, "title"); !errors.Is(err, indexingapp.ErrIndexResolverRecordNotFound) {
		t.Fatalf("invalid project ID error=%v", err)
	}
	if _, err := newCurrentIndexResolverRepository(nil); err == nil {
		t.Fatal("nil project store was accepted")
	}
}
