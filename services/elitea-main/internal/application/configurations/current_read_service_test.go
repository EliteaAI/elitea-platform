package configurations

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type currentConfigurationBaseReaderStub struct {
	listResult CurrentConfigurationListResult
	listErr    error
	getResult  CurrentConfiguration
	getErr     error
	listCalls  int
	getCalls   int
	request    CurrentConfigurationListRequest
	projectID  int32
	configID   int32
}

func (s *currentConfigurationBaseReaderStub) List(
	_ context.Context,
	request CurrentConfigurationListRequest,
) (CurrentConfigurationListResult, error) {
	s.listCalls++
	s.request = request
	return s.listResult, s.listErr
}

func (s *currentConfigurationBaseReaderStub) Get(
	_ context.Context,
	projectID, configurationID int32,
) (CurrentConfiguration, error) {
	s.getCalls++
	s.projectID = projectID
	s.configID = configurationID
	return s.getResult, s.getErr
}

func TestCurrentConfigurationReadServiceEnrichesProjectAndSharedPages(t *testing.T) {
	base := &currentConfigurationBaseReaderStub{
		listResult: CurrentConfigurationListResult{
			CurrentConfigurationPage: CurrentConfigurationPage{
				Items: []CurrentConfiguration{{ID: 7, ProjectID: 2, Type: "consumer"}},
				Total: 1, Limit: 20,
			},
			Shared: &CurrentConfigurationPage{
				Items: []CurrentConfiguration{{ID: 8, ProjectID: 1, Type: "consumer"}},
				Total: 1, Limit: 20,
			},
		},
	}
	candidates := &currentConfigurationOptionsCandidatesStub{
		list: func(_ context.Context, query CurrentConfigurationOptionCandidatesQuery) ([]CurrentConfigurationOption, error) {
			switch query.ProjectID {
			case 2:
				return []CurrentConfigurationOption{{
					EliteaTitle: "project_github", Type: "github", Section: "credentials", ProjectID: 2,
				}}, nil
			case 1:
				return []CurrentConfigurationOption{{
					EliteaTitle: "public_github", Type: "github", Section: "credentials", Shared: true, ProjectID: 1,
				}}, nil
			default:
				t.Fatalf("unexpected options project %d", query.ProjectID)
				return nil, nil
			}
		},
	}
	service := mustCurrentConfigurationReadService(t, base, candidates)
	request := CurrentConfigurationListRequest{
		ProjectID: 2, PublicProjectID: 1, IncludeShared: true, Limit: 20, SharedLimit: 20,
	}

	result, err := service.List(context.Background(), request)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if base.listCalls != 1 || !reflect.DeepEqual(base.request, request) || candidates.calls != 2 {
		t.Fatalf("base calls=%d request=%#v option calls=%d", base.listCalls, base.request, candidates.calls)
	}
	projectOptions := (*result.Items[0].Options)["credential"].([]CurrentConfigurationOption)
	sharedOptions := (*result.Shared.Items[0].Options)["credential"].([]CurrentConfigurationOption)
	if len(projectOptions) != 1 || projectOptions[0].EliteaTitle != "project_github" ||
		len(sharedOptions) != 1 || sharedOptions[0].EliteaTitle != "public_github" {
		t.Fatalf("project options=%#v shared options=%#v", projectOptions, sharedOptions)
	}
}

func TestCurrentConfigurationReadServiceListDegradesOptionsFailuresPerPage(t *testing.T) {
	base := &currentConfigurationBaseReaderStub{
		listResult: CurrentConfigurationListResult{
			CurrentConfigurationPage: CurrentConfigurationPage{
				Items: []CurrentConfiguration{{ID: 7, ProjectID: 2, Type: "consumer"}},
			},
			Shared: &CurrentConfigurationPage{
				Items: []CurrentConfiguration{{ID: 8, ProjectID: 1, Type: "plain"}},
			},
		},
	}
	candidates := &currentConfigurationOptionsCandidatesStub{
		list: func(_ context.Context, query CurrentConfigurationOptionCandidatesQuery) ([]CurrentConfigurationOption, error) {
			if query.ProjectID == 2 {
				return nil, errors.New("project options unavailable")
			}
			return nil, nil
		},
	}
	service := mustCurrentConfigurationReadService(t, base, candidates)

	result, err := service.List(context.Background(), CurrentConfigurationListRequest{
		ProjectID: 2, PublicProjectID: 1, IncludeShared: true,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if candidates.calls != 1 {
		// The shared plain row has no nested selector and does not query.
		t.Fatalf("option calls=%d", candidates.calls)
	}
	if result.Items[0].Options == nil || len(*result.Items[0].Options) != 0 ||
		result.Shared.Items[0].Options == nil || len(*result.Shared.Items[0].Options) != 0 {
		t.Fatalf("project=%#v shared=%#v", result.Items, result.Shared.Items)
	}
}

func TestCurrentConfigurationReadServiceDetailIsStrictAndIncludesShared(t *testing.T) {
	base := &currentConfigurationBaseReaderStub{
		getResult: CurrentConfiguration{ID: 9, ProjectID: 2, Type: "consumer"},
	}
	candidates := &currentConfigurationOptionsCandidatesStub{
		list: func(_ context.Context, query CurrentConfigurationOptionCandidatesQuery) ([]CurrentConfigurationOption, error) {
			if !query.IncludeShared || query.ProjectID != 2 || query.PublicProjectID != 1 {
				t.Fatalf("query=%#v", query)
			}
			return []CurrentConfigurationOption{{
				EliteaTitle: "public_github", Type: "github", Section: "credentials", Shared: true, ProjectID: 1,
			}}, nil
		},
	}
	service := mustCurrentConfigurationReadService(t, base, candidates)

	result, err := service.Get(context.Background(), 2, 9)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	options := (*result.Options)["credential"].([]CurrentConfigurationOption)
	if base.getCalls != 1 || base.projectID != 2 || base.configID != 9 ||
		len(options) != 1 || options[0].EliteaTitle != "public_github" {
		t.Fatalf("base=%#v result=%#v", base, result)
	}

	dependencyErr := errors.New("options unavailable")
	candidates.list = func(context.Context, CurrentConfigurationOptionCandidatesQuery) ([]CurrentConfigurationOption, error) {
		return nil, dependencyErr
	}
	if _, err := service.Get(context.Background(), 2, 9); !errors.Is(err, dependencyErr) {
		t.Fatalf("strict detail error=%v", err)
	}
}

func TestCurrentConfigurationReadServiceValidatesCompositionAndCancellation(t *testing.T) {
	catalog := currentConfigurationOptionsCatalog(t)
	candidates := &currentConfigurationOptionsCandidatesStub{}
	options := mustCurrentConfigurationOptionsEnricher(t, catalog, candidates)
	base := &currentConfigurationBaseReaderStub{}

	invalid := []struct {
		base    CurrentConfigurationBaseReader
		options *CurrentConfigurationOptionsEnricher
		public  int32
	}{
		{nil, options, 1},
		{base, nil, 1},
		{base, options, 0},
	}
	for _, test := range invalid {
		if _, err := NewCurrentConfigurationReadService(test.base, test.options, test.public); err == nil {
			t.Fatalf("accepted invalid composition %#v", test)
		}
	}

	service, err := NewCurrentConfigurationReadService(base, options, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.List(context.Background(), CurrentConfigurationListRequest{
		ProjectID: 2, PublicProjectID: 3,
	}); !errors.Is(err, ErrInvalidCurrentConfigurationRequest) {
		t.Fatalf("public project mismatch error=%v", err)
	}

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	base.listResult = CurrentConfigurationListResult{
		CurrentConfigurationPage: CurrentConfigurationPage{
			Items: []CurrentConfiguration{{ProjectID: 2, Type: "consumer"}},
		},
	}
	if _, err := service.List(canceled, CurrentConfigurationListRequest{
		ProjectID: 2, PublicProjectID: 1,
	}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled error=%v", err)
	}
}

func mustCurrentConfigurationReadService(
	t *testing.T,
	base CurrentConfigurationBaseReader,
	candidates CurrentConfigurationOptionCandidates,
) *CurrentConfigurationReadService {
	t.Helper()
	options := mustCurrentConfigurationOptionsEnricher(
		t,
		currentConfigurationOptionsCatalog(t),
		candidates,
	)
	service, err := NewCurrentConfigurationReadService(base, options, 1)
	if err != nil {
		t.Fatalf("new current configuration read service: %v", err)
	}
	return service
}
