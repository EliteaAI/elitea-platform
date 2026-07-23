package configurations

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

type currentConfigurationOptionsCandidatesStub struct {
	list  func(context.Context, CurrentConfigurationOptionCandidatesQuery) ([]CurrentConfigurationOption, error)
	calls int
	query CurrentConfigurationOptionCandidatesQuery
}

func (s *currentConfigurationOptionsCandidatesStub) ListCurrentConfigurationOptionCandidates(
	ctx context.Context,
	query CurrentConfigurationOptionCandidatesQuery,
) ([]CurrentConfigurationOption, error) {
	s.calls++
	s.query = query
	if s.list == nil {
		return nil, nil
	}
	return s.list(ctx, query)
}

func TestCurrentConfigurationOptionsEnricherPrefetchesOnceAndPreservesWireShape(t *testing.T) {
	label := "Project GitHub"
	candidates := &currentConfigurationOptionsCandidatesStub{
		list: func(_ context.Context, _ CurrentConfigurationOptionCandidatesQuery) ([]CurrentConfigurationOption, error) {
			return []CurrentConfigurationOption{
				{EliteaTitle: "github_project", Label: &label, Type: "github", Section: "credentials", ProjectID: 7},
				{EliteaTitle: "azure_public", Type: "azure_openai", Section: "ai_credentials", Shared: true, ProjectID: 1},
				{EliteaTitle: "github_public", Type: "github", Section: "credentials", Shared: true, ProjectID: 1},
				{EliteaTitle: "ignored", Type: "jira", Section: "credentials", ProjectID: 7},
			}, nil
		},
	}
	enricher := mustCurrentConfigurationOptionsEnricher(t, currentConfigurationOptionsCatalog(t), candidates)

	result, err := enricher.Enrich(context.Background(), CurrentConfigurationOptionsRequest{
		ProjectID:       7,
		PublicProjectID: 1,
		IncludeShared:   true,
		Configurations: []CurrentConfiguration{
			{ID: 10, ProjectID: 7, Type: "consumer"},
			{ID: 11, ProjectID: 7, Type: "consumer"},
		},
	})
	if err != nil {
		t.Fatalf("enrich: %v", err)
	}
	if candidates.calls != 1 {
		t.Fatalf("candidate calls=%d, want one prefetch", candidates.calls)
	}
	wantQuery := CurrentConfigurationOptionCandidatesQuery{
		ProjectID: 7, PublicProjectID: 1, IncludeShared: true,
		Types: []string{"github"}, Sections: []string{"ai_credentials"},
		MaxRows: currentConfigurationOptionQueryRows,
	}
	if !reflect.DeepEqual(candidates.query, wantQuery) {
		t.Fatalf("query=%#v want=%#v", candidates.query, wantQuery)
	}
	if len(result) != 2 || result[0].Options == nil || result[1].Options == nil {
		t.Fatalf("result=%#v", result)
	}

	raw, err := json.Marshal(result[0].Options)
	if err != nil {
		t.Fatalf("marshal options: %v", err)
	}
	const want = `{"ai_credentials":[{"elitea_title":"azure_public","label":null,"type":"azure_openai","section":"ai_credentials","shared":true,"project_id":1}],"credential":[{"elitea_title":"github_project","label":"Project GitHub","type":"github","section":"credentials","shared":false,"project_id":7},{"elitea_title":"github_public","label":null,"type":"github","section":"credentials","shared":true,"project_id":1}]}`
	if string(raw) != want {
		t.Fatalf("options=%s want=%s", raw, want)
	}

	label = "mutated outside"
	firstOptions := *result[0].Options
	firstCredential := firstOptions["credential"].([]CurrentConfigurationOption)
	secondCredential := (*result[1].Options)["credential"].([]CurrentConfigurationOption)
	*firstCredential[0].Label = "mutated first result"
	if secondCredential[0].Label == nil || *secondCredential[0].Label != "Project GitHub" {
		t.Fatalf("options alias across results: %#v", secondCredential)
	}
}

func TestCurrentConfigurationOptionsEnricherReturnsPresentEmptyObjectWithoutPrefetch(t *testing.T) {
	candidates := &currentConfigurationOptionsCandidatesStub{}
	enricher := mustCurrentConfigurationOptionsEnricher(t, currentConfigurationOptionsCatalog(t), candidates)

	result, err := enricher.Enrich(context.Background(), CurrentConfigurationOptionsRequest{
		ProjectID: 7, PublicProjectID: 1,
		Configurations: []CurrentConfiguration{
			{ProjectID: 7, Type: "plain"},
			{ProjectID: 7, Type: "unknown"},
		},
	})
	if err != nil {
		t.Fatalf("enrich: %v", err)
	}
	if candidates.calls != 0 {
		t.Fatalf("candidate calls=%d", candidates.calls)
	}
	for index, configuration := range result {
		if configuration.Options == nil || len(*configuration.Options) != 0 {
			t.Fatalf("result[%d] options=%#v", index, configuration.Options)
		}
		raw, err := json.Marshal(configuration.Options)
		if err != nil || string(raw) != "{}" {
			t.Fatalf("result[%d] JSON=%s err=%v", index, raw, err)
		}
	}
}

func TestCurrentConfigurationOptionsEnricherUsesPinnedModelSchemaAnnotation(t *testing.T) {
	catalog, err := LoadPinnedCurrentAvailableCatalog()
	if err != nil {
		t.Fatalf("load pinned catalog: %v", err)
	}
	candidates := &currentConfigurationOptionsCandidatesStub{
		list: func(_ context.Context, _ CurrentConfigurationOptionCandidatesQuery) ([]CurrentConfigurationOption, error) {
			return []CurrentConfigurationOption{{
				EliteaTitle: "azure_credentials", Type: "azure_openai",
				Section: "ai_credentials", ProjectID: 7,
			}}, nil
		},
	}
	enricher := mustCurrentConfigurationOptionsEnricher(t, catalog, candidates)

	result, err := enricher.Enrich(context.Background(), CurrentConfigurationOptionsRequest{
		ProjectID: 7, PublicProjectID: 1,
		Configurations: []CurrentConfiguration{{ProjectID: 7, Type: "llm_model"}},
	})
	if err != nil {
		t.Fatalf("enrich llm_model: %v", err)
	}
	if !reflect.DeepEqual(candidates.query.Sections, []string{"ai_credentials"}) ||
		len(candidates.query.Types) != 0 {
		t.Fatalf("query=%#v", candidates.query)
	}
	options := (*result[0].Options)["ai_credentials"].([]CurrentConfigurationOption)
	if len(options) != 1 || options[0].EliteaTitle != "azure_credentials" {
		t.Fatalf("options=%#v", options)
	}
}

func TestCurrentConfigurationOptionsEnricherPreservesPublicProjectBaselineVisibility(t *testing.T) {
	candidates := &currentConfigurationOptionsCandidatesStub{
		list: func(_ context.Context, _ CurrentConfigurationOptionCandidatesQuery) ([]CurrentConfigurationOption, error) {
			return []CurrentConfigurationOption{{
				EliteaTitle: "public_private", Type: "github", Section: "credentials",
				Shared: false, ProjectID: 1,
			}}, nil
		},
	}
	enricher := mustCurrentConfigurationOptionsEnricher(t, currentConfigurationOptionsCatalog(t), candidates)

	result, err := enricher.Enrich(context.Background(), CurrentConfigurationOptionsRequest{
		ProjectID: 1, PublicProjectID: 1, IncludeShared: true,
		Configurations: []CurrentConfiguration{{ProjectID: 1, Type: "consumer"}},
	})
	if err != nil {
		t.Fatalf("enrich public page: %v", err)
	}
	options := (*result[0].Options)["credential"].([]CurrentConfigurationOption)
	if len(options) != 1 || options[0].EliteaTitle != "public_private" {
		t.Fatalf("options=%#v", options)
	}
}

func TestCurrentConfigurationOptionsEnricherFailsClosedOnVisibilityAndBounds(t *testing.T) {
	tests := []struct {
		name       string
		candidates []CurrentConfigurationOption
		want       error
	}{
		{
			name: "non-shared public row",
			candidates: []CurrentConfigurationOption{{
				EliteaTitle: "hidden", Type: "github", Section: "credentials",
				ProjectID: 1,
			}},
			want: ErrInvalidCurrentConfigurationOptionsRequest,
		},
		{
			name:       "overflow sentinel",
			candidates: make([]CurrentConfigurationOption, currentConfigurationOptionQueryRows),
			want:       ErrCurrentConfigurationOptionsTooLarge,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidates := &currentConfigurationOptionsCandidatesStub{
				list: func(_ context.Context, _ CurrentConfigurationOptionCandidatesQuery) ([]CurrentConfigurationOption, error) {
					return test.candidates, nil
				},
			}
			enricher := mustCurrentConfigurationOptionsEnricher(t, currentConfigurationOptionsCatalog(t), candidates)
			_, err := enricher.Enrich(context.Background(), CurrentConfigurationOptionsRequest{
				ProjectID: 7, PublicProjectID: 1, IncludeShared: true,
				Configurations: []CurrentConfiguration{{ProjectID: 7, Type: "consumer"}},
			})
			if !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
		})
	}
}

func TestCurrentConfigurationOptionsEnricherValidatesRequestsAndPreservesDependencyErrors(t *testing.T) {
	dependencyErr := errors.New("database unavailable")
	candidates := &currentConfigurationOptionsCandidatesStub{
		list: func(_ context.Context, _ CurrentConfigurationOptionCandidatesQuery) ([]CurrentConfigurationOption, error) {
			return nil, dependencyErr
		},
	}
	enricher := mustCurrentConfigurationOptionsEnricher(t, currentConfigurationOptionsCatalog(t), candidates)

	_, err := enricher.Enrich(context.Background(), CurrentConfigurationOptionsRequest{
		ProjectID: 7, PublicProjectID: 1,
		Configurations: []CurrentConfiguration{{ProjectID: 7, Type: "consumer"}},
	})
	if !errors.Is(err, dependencyErr) {
		t.Fatalf("dependency error=%v", err)
	}

	invalidRequests := []CurrentConfigurationOptionsRequest{
		{ProjectID: 0, PublicProjectID: 1},
		{ProjectID: 7, PublicProjectID: 0},
		{ProjectID: 7, PublicProjectID: 1, Configurations: []CurrentConfiguration{{ProjectID: 8}}},
		{ProjectID: 7, PublicProjectID: 1, Configurations: make([]CurrentConfiguration, MaxCurrentConfigurationListLimit+1)},
	}
	for _, request := range invalidRequests {
		if _, err := enricher.Enrich(context.Background(), request); !errors.Is(err, ErrInvalidCurrentConfigurationOptionsRequest) {
			t.Fatalf("request=%#v error=%v", request, err)
		}
	}

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := enricher.Enrich(canceled, CurrentConfigurationOptionsRequest{
		ProjectID: 7, PublicProjectID: 1,
	}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled error=%v", err)
	}
	if candidates.calls != 1 {
		t.Fatalf("candidate calls=%d after invalid/canceled requests", candidates.calls)
	}
}

func TestCurrentConfigurationOptionSelectorsMatchCurrentTraversalPrecedence(t *testing.T) {
	selectors, err := currentConfigurationOptionSelectors(map[string]any{
		"properties": map[string]any{
			"nested": map[string]any{
				"configuration_types":    []any{"github"},
				"configuration_sections": []any{"credentials"},
			},
		},
	})
	if err != nil {
		t.Fatalf("selectors: %v", err)
	}
	if !reflect.DeepEqual(selectors, map[string]currentConfigurationOptionSelector{
		"nested": {types: []string{"github"}},
	}) {
		t.Fatalf("selectors=%#v", selectors)
	}

	if _, err := currentConfigurationOptionSelectors(map[string]any{
		"configuration_types": "github",
	}); !errors.Is(err, ErrInvalidCurrentConfigurationOptionsRequest) {
		t.Fatalf("invalid annotation error=%v", err)
	}
}

func mustCurrentConfigurationOptionsEnricher(
	t *testing.T,
	catalog *CurrentAvailableCatalog,
	candidates CurrentConfigurationOptionCandidates,
) *CurrentConfigurationOptionsEnricher {
	t.Helper()
	enricher, err := NewCurrentConfigurationOptionsEnricher(catalog, candidates)
	if err != nil {
		t.Fatalf("new enricher: %v", err)
	}
	return enricher
}

func currentConfigurationOptionsCatalog(t *testing.T) *CurrentAvailableCatalog {
	t.Helper()
	entries := []CurrentAvailableConfigurationType{
		currentConfigurationOptionsCatalogEntry(t, "consumer", map[string]any{
			"properties": map[string]any{
				"credential": map[string]any{"configuration_types": []string{"github"}},
				"ai_credentials": map[string]any{
					"anyOf":                  []any{map[string]any{"type": "object"}, map[string]any{"type": "null"}},
					"configuration_sections": []string{"ai_credentials"},
				},
			},
		}),
		currentConfigurationOptionsCatalogEntry(t, "plain", map[string]any{
			"properties": map[string]any{"endpoint": map[string]any{"type": "string"}},
		}),
	}
	return &CurrentAvailableCatalog{
		entries:      entries,
		entryIndexes: map[string]int{"consumer": 0, "plain": 1},
		complete:     true,
	}
}

func currentConfigurationOptionsCatalogEntry(
	t *testing.T,
	typeName string,
	dataSchema map[string]any,
) CurrentAvailableConfigurationType {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"data": dataSchema,
		},
	})
	if err != nil {
		t.Fatalf("marshal catalog entry: %v", err)
	}
	return CurrentAvailableConfigurationType{Type: typeName, Section: "test", ConfigSchema: raw}
}
