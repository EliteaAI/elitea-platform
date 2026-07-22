package repos

import (
	"context"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"testing"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/jackc/pgx/v5"
)

func TestCurrentModelsRepositoryRoutesAuthorizedTenantQuery(t *testing.T) {
	label := "Embedding One"
	queries := &currentModelQueriesStub{rows: []sqlcgen.ListCurrentModelConfigurationsRow{
		currentModelRow(11, 7, configurationapp.CurrentModelSectionEmbedding, label, false, `{"name":"embedding-one"}`),
	}}
	projects := &currentModelProjectStore{}
	repository := newCurrentModelsRepositoryForTest(t, projects, queries)

	items, err := repository.List(context.Background(), 7, configurationapp.CurrentModelSectionEmbedding, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Name != "embedding-one" || items[0].DisplayName == nil ||
		*items[0].DisplayName != label || items[0].ProjectID != 7 || items[0].Shared {
		t.Fatalf("mapped items=%#v", items)
	}
	if !reflect.DeepEqual(projects.projectIDs, []int64{7}) || len(projects.options) != 1 ||
		projects.options[0].IsoLevel != pgx.ReadCommitted || projects.options[0].AccessMode != pgx.ReadOnly {
		t.Fatalf("project transaction ids=%v options=%#v", projects.projectIDs, projects.options)
	}
	wantParams := sqlcgen.ListCurrentModelConfigurationsParams{
		ProjectID: 7, Section: "embedding", SharedOnly: false, LimitRows: currentModelCatalogQueryRows,
	}
	if queries.calls != 1 || !reflect.DeepEqual(queries.params, wantParams) {
		t.Fatalf("query calls=%d params=%#v", queries.calls, queries.params)
	}
}

func TestCurrentModelsRepositoryPreservesSectionShapesAndPublicSharedFilter(t *testing.T) {
	tests := []struct {
		name       string
		section    configurationapp.CurrentModelSection
		row        sqlcgen.ListCurrentModelConfigurationsRow
		sharedOnly bool
		assert     func(*testing.T, configurationapp.CurrentModelCatalogItem)
	}{
		{
			name:    "vector storage uses title without parsing unrelated data",
			section: configurationapp.CurrentModelSectionVectorStorage,
			row:     currentModelRow(1, 7, configurationapp.CurrentModelSectionVectorStorage, "", false, `[]`),
			assert: func(t *testing.T, item configurationapp.CurrentModelCatalogItem) {
				t.Helper()
				if item.Name != "title-1" || item.DisplayName != nil {
					t.Fatalf("vector storage item=%#v", item)
				}
			},
		},
		{
			name:       "public shared model remains marked shared",
			section:    configurationapp.CurrentModelSectionTTS,
			row:        currentModelRow(2, 1, configurationapp.CurrentModelSectionTTS, "Voice", true, `{"name":"voice-one"}`),
			sharedOnly: true,
			assert: func(t *testing.T, item configurationapp.CurrentModelCatalogItem) {
				t.Helper()
				if item.Name != "voice-one" || item.DisplayName == nil || *item.DisplayName != "Voice" || !item.Shared {
					t.Fatalf("shared TTS item=%#v", item)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			queries := &currentModelQueriesStub{rows: []sqlcgen.ListCurrentModelConfigurationsRow{test.row}}
			repository := newCurrentModelsRepositoryForTest(t, &currentModelProjectStore{}, queries)
			items, err := repository.List(context.Background(), test.row.ProjectID, test.section, test.sharedOnly)
			if err != nil || len(items) != 1 {
				t.Fatalf("items=%#v err=%v", items, err)
			}
			test.assert(t, items[0])
			if queries.params.SharedOnly != test.sharedOnly {
				t.Fatalf("shared-only query=%#v", queries.params)
			}
		})
	}
}

func TestCurrentModelsRepositoryOrdersLLMDuplicatesForCurrentMaxTokenSelection(t *testing.T) {
	queries := &currentModelQueriesStub{rows: []sqlcgen.ListCurrentModelConfigurationsRow{
		currentModelRow(1, 7, configurationapp.CurrentModelSectionLLM, "Alpha Max", false,
			`{"name":"alpha","context_window":200000,"max_output_tokens":32000,"supports_reasoning":true,"supports_vision":false,"low_tier":true,"mid_tier":true,"openai_compatible":true}`),
		currentModelRow(2, 7, configurationapp.CurrentModelSectionLLM, "Beta", false,
			`{"name":"beta","max_output_tokens":8000}`),
		currentModelRow(3, 7, configurationapp.CurrentModelSectionLLM, "Alpha Newer But Smaller", false,
			`{"name":"alpha","max_output_tokens":16000,"high_tier":false,"mid_tier":true}`),
	}}
	repository := newCurrentModelsRepositoryForTest(t, &currentModelProjectStore{}, queries)

	items, err := repository.List(context.Background(), 7, configurationapp.CurrentModelSectionLLM, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 || items[0].Name != "alpha" || items[0].MaxOutputTokens == nil || *items[0].MaxOutputTokens != 16000 ||
		items[1].Name != "beta" || items[2].Name != "alpha" || items[2].MaxOutputTokens == nil || *items[2].MaxOutputTokens != 32000 {
		t.Fatalf("ordered LLM candidates=%#v", items)
	}
	if items[0].HighTier == nil || *items[0].HighTier {
		t.Fatalf("explicit high-tier=false did not override mid-tier fallback: %#v", items[0])
	}
	if items[2].HighTier == nil || !*items[2].HighTier || items[2].SupportsReasoning == nil || !*items[2].SupportsReasoning ||
		items[2].SupportsVision == nil || *items[2].SupportsVision || items[2].LowTier == nil || !*items[2].LowTier ||
		items[2].OpenAICompatible == nil || !*items[2].OpenAICompatible || items[2].ContextWindow == nil || *items[2].ContextWindow != 200000 {
		t.Fatalf("LLM fields=%#v", items[2])
	}

	response := configurationapp.BuildCurrentModelCatalog(configurationapp.CurrentModelCatalogRequest{
		Section:      configurationapp.CurrentModelSectionLLM,
		ProjectID:    7,
		ProjectItems: items,
	})
	if response.Total != 2 || response.DefaultModelName == nil || *response.DefaultModelName != "alpha" {
		t.Fatalf("catalog response=%#v", response)
	}
	var alpha configurationapp.CurrentModelCatalogItem
	for _, item := range response.Items {
		if item.Name == "alpha" {
			alpha = item
		}
	}
	if alpha.MaxOutputTokens == nil || *alpha.MaxOutputTokens != 32000 || alpha.DisplayName == nil || *alpha.DisplayName != "Alpha Max" {
		t.Fatalf("deduplicated max-token LLM=%#v", alpha)
	}
}

func TestCurrentModelsRepositoryUsesLLMDefaultMaxForDuplicateOrdering(t *testing.T) {
	queries := &currentModelQueriesStub{rows: []sqlcgen.ListCurrentModelConfigurationsRow{
		currentModelRow(1, 7, configurationapp.CurrentModelSectionLLM, "Explicit Small", false,
			`{"name":"alpha","max_output_tokens":8000}`),
		currentModelRow(2, 7, configurationapp.CurrentModelSectionLLM, "Implicit Default", false,
			`{"name":"alpha"}`),
	}}
	repository := newCurrentModelsRepositoryForTest(t, &currentModelProjectStore{}, queries)
	items, err := repository.List(context.Background(), 7, configurationapp.CurrentModelSectionLLM, false)
	if err != nil || len(items) != 2 {
		t.Fatalf("items=%#v err=%v", items, err)
	}
	if items[1].MaxOutputTokens != nil || items[1].DisplayName == nil || *items[1].DisplayName != "Implicit Default" {
		t.Fatalf("implicit current default did not win=%#v", items)
	}
}

func TestCurrentModelsRepositoryRejectsInvalidRowsWithoutLeakingValues(t *testing.T) {
	valid := currentModelRow(1, 7, configurationapp.CurrentModelSectionLLM, "Model", true,
		`{"name":"model","context_window":128000,"max_output_tokens":16000}`)
	tests := []struct {
		name       string
		row        sqlcgen.ListCurrentModelConfigurationsRow
		sharedOnly bool
	}{
		{name: "wrong project", row: func() sqlcgen.ListCurrentModelConfigurationsRow { row := valid; row.ProjectID = 8; return row }()},
		{name: "wrong section", row: func() sqlcgen.ListCurrentModelConfigurationsRow { row := valid; row.Section = "embedding"; return row }()},
		{name: "public row not shared", sharedOnly: true, row: func() sqlcgen.ListCurrentModelConfigurationsRow { row := valid; row.Shared = false; return row }()},
		{name: "missing display name", row: func() sqlcgen.ListCurrentModelConfigurationsRow { row := valid; row.Label = nil; return row }()},
		{name: "data is not object", row: func() sqlcgen.ListCurrentModelConfigurationsRow { row := valid; row.Data = []byte(`[]`); return row }()},
		{name: "name has wrong type", row: func() sqlcgen.ListCurrentModelConfigurationsRow {
			row := valid
			row.Data = []byte(`{"name":7}`)
			return row
		}()},
		{name: "numeric string is rejected before database cast", row: func() sqlcgen.ListCurrentModelConfigurationsRow {
			row := valid
			row.Data = []byte(`{"name":"model","max_output_tokens":"private-secret"}`)
			return row
		}()},
		{name: "boolean string is rejected", row: func() sqlcgen.ListCurrentModelConfigurationsRow {
			row := valid
			row.Data = []byte(`{"name":"model","supports_vision":"private-secret"}`)
			return row
		}()},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			queries := &currentModelQueriesStub{rows: []sqlcgen.ListCurrentModelConfigurationsRow{test.row}}
			repository := newCurrentModelsRepositoryForTest(t, &currentModelProjectStore{}, queries)
			_, err := repository.List(context.Background(), 7, configurationapp.CurrentModelSectionLLM, test.sharedOnly)
			if !errors.Is(err, errInvalidCurrentModelConfiguration) {
				t.Fatalf("error=%v", err)
			}
			if strings.Contains(err.Error(), "private-secret") {
				t.Fatalf("malformed value leaked: %v", err)
			}
		})
	}
}

func TestCurrentModelsRepositoryValidatesRequestAndBoundsCatalog(t *testing.T) {
	queries := &currentModelQueriesStub{}
	projects := &currentModelProjectStore{}
	repository := newCurrentModelsRepositoryForTest(t, projects, queries)

	requests := []struct {
		ctx       context.Context
		projectID int32
		section   configurationapp.CurrentModelSection
	}{
		{ctx: nil, projectID: 7, section: configurationapp.CurrentModelSectionLLM},
		{ctx: context.Background(), projectID: 0, section: configurationapp.CurrentModelSectionLLM},
		{ctx: context.Background(), projectID: 7, section: configurationapp.CurrentModelSection("unknown")},
	}
	for _, request := range requests {
		_, err := repository.List(request.ctx, request.projectID, request.section, false)
		if !errors.Is(err, configurationapp.ErrInvalidCurrentConfigurationRequest) {
			t.Fatalf("invalid request error=%v", err)
		}
	}
	if queries.calls != 0 || len(projects.projectIDs) != 0 {
		t.Fatalf("invalid request reached database: calls=%d projects=%v", queries.calls, projects.projectIDs)
	}

	label := "Model"
	queries.rows = make([]sqlcgen.ListCurrentModelConfigurationsRow, currentModelCatalogQueryRows)
	for index := range queries.rows {
		queries.rows[index] = currentModelRow(int32(index+1), 7, configurationapp.CurrentModelSectionEmbedding, label, false, `{"name":"model"}`)
	}
	_, err := repository.List(context.Background(), 7, configurationapp.CurrentModelSectionEmbedding, false)
	if !errors.Is(err, errCurrentModelCatalogTooLarge) {
		t.Fatalf("catalog limit error=%v", err)
	}
}

func TestNewCurrentModelsRepositoryRejectsMissingDependencies(t *testing.T) {
	if _, err := NewCurrentModelsRepository(nil); err == nil {
		t.Fatal("nil database pool was accepted")
	}
	if _, err := newCurrentModelsRepository(nil, func(sqlExecutor) (currentModelQueries, error) { return &currentModelQueriesStub{}, nil }); err == nil {
		t.Fatal("nil project store was accepted")
	}
	if _, err := newCurrentModelsRepository(&currentModelProjectStore{}, nil); err == nil {
		t.Fatal("nil query factory was accepted")
	}
}

func newCurrentModelsRepositoryForTest(t *testing.T, projects projectStore, queries currentModelQueries) *CurrentModelsRepository {
	t.Helper()
	repository, err := newCurrentModelsRepository(projects, func(sqlExecutor) (currentModelQueries, error) {
		return queries, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return repository
}

func currentModelRow(
	id, projectID int32,
	section configurationapp.CurrentModelSection,
	label string,
	shared bool,
	data string,
) sqlcgen.ListCurrentModelConfigurationsRow {
	var displayName *string
	if label != "" {
		value := label
		displayName = &value
	}
	return sqlcgen.ListCurrentModelConfigurationsRow{
		ID: id, ProjectID: projectID, Label: displayName, EliteaTitle: "title-" + strconv.FormatInt(int64(id), 10),
		Section: string(section), Data: []byte(data), Shared: shared,
	}
}

type currentModelProjectStore struct {
	projectIDs []int64
	options    []pgx.TxOptions
}

func (s *currentModelProjectStore) WithinProjectTx(_ context.Context, projectID int64, options pgx.TxOptions, fn func(sqlExecutor) error) error {
	s.projectIDs = append(s.projectIDs, projectID)
	s.options = append(s.options, options)
	return fn(nil)
}

type currentModelQueriesStub struct {
	rows   []sqlcgen.ListCurrentModelConfigurationsRow
	err    error
	params sqlcgen.ListCurrentModelConfigurationsParams
	calls  int
}

func (s *currentModelQueriesStub) ListCurrentModelConfigurations(
	_ context.Context,
	params sqlcgen.ListCurrentModelConfigurationsParams,
) ([]sqlcgen.ListCurrentModelConfigurationsRow, error) {
	s.calls++
	s.params = params
	return s.rows, s.err
}
