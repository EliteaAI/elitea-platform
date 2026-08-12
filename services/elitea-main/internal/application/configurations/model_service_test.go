package configurations

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type currentModelCandidateCall struct {
	projectID  int32
	section    CurrentModelSection
	sharedOnly bool
}

type currentModelCandidateRepositoryStub struct {
	list  func(context.Context, int32, CurrentModelSection, bool) ([]CurrentModelCatalogItem, error)
	calls []currentModelCandidateCall
}

func (s *currentModelCandidateRepositoryStub) List(
	ctx context.Context,
	projectID int32,
	section CurrentModelSection,
	sharedOnly bool,
) ([]CurrentModelCatalogItem, error) {
	s.calls = append(s.calls, currentModelCandidateCall{projectID: projectID, section: section, sharedOnly: sharedOnly})
	if s.list == nil {
		return nil, nil
	}
	return s.list(ctx, projectID, section, sharedOnly)
}

type currentModelDefaultsLoaderStub struct {
	load  func(context.Context, int32, int32, CurrentModelSection) (CurrentModelCatalogDefaults, error)
	calls int
}

func (s *currentModelDefaultsLoaderStub) Load(
	ctx context.Context,
	projectID, publicProjectID int32,
	section CurrentModelSection,
) (CurrentModelCatalogDefaults, error) {
	s.calls++
	if s.load == nil {
		return CurrentModelCatalogDefaults{}, nil
	}
	return s.load(ctx, projectID, publicProjectID, section)
}

func TestCurrentModelCatalogServiceOrchestratesProjectPublicAndDefaults(t *testing.T) {
	projectDisplay := "Zulu"
	publicDisplay := "Alpha"
	repository := &currentModelCandidateRepositoryStub{list: func(
		_ context.Context,
		projectID int32,
		_ CurrentModelSection,
		sharedOnly bool,
	) ([]CurrentModelCatalogItem, error) {
		if sharedOnly {
			return []CurrentModelCatalogItem{{Name: "public", DisplayName: &publicDisplay, ProjectID: projectID, Shared: true}}, nil
		}
		return []CurrentModelCatalogItem{{Name: "project", DisplayName: &projectDisplay, ProjectID: projectID}}, nil
	}}
	defaults := &currentModelDefaultsLoaderStub{load: func(
		_ context.Context,
		projectID, publicProjectID int32,
		section CurrentModelSection,
	) (CurrentModelCatalogDefaults, error) {
		if projectID != 7 || publicProjectID != 1 || section != CurrentModelSectionEmbedding {
			t.Fatalf("defaults request=(%d,%d,%q)", projectID, publicProjectID, section)
		}
		return CurrentModelCatalogDefaults{Model: CurrentModelDefaultSources{
			Public: CurrentModelDefault{Name: "public", ProjectID: "1"},
		}}, nil
	}}
	service, err := NewCurrentModelCatalogService(repository, defaults)
	if err != nil {
		t.Fatal(err)
	}

	response, err := service.Get(context.Background(), CurrentModelCatalogQuery{
		Section: CurrentModelSectionEmbedding, ProjectID: 7, PublicProjectID: 1, IncludeShared: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	wantCalls := []currentModelCandidateCall{
		{projectID: 7, section: CurrentModelSectionEmbedding},
		{projectID: 1, section: CurrentModelSectionEmbedding, sharedOnly: true},
	}
	if !reflect.DeepEqual(repository.calls, wantCalls) || defaults.calls != 1 {
		t.Fatalf("repository calls=%#v defaults=%d", repository.calls, defaults.calls)
	}
	if response.Total != 2 || response.DefaultModelName == nil || *response.DefaultModelName != "public" ||
		response.DefaultModelProjectID == nil || *response.DefaultModelProjectID != 1 ||
		len(response.Items) != 2 || response.Items[0].Name != "public" || !response.Items[0].Default {
		t.Fatalf("response=%#v", response)
	}
}

func TestCurrentModelCatalogServiceSupportsAllCurrentSections(t *testing.T) {
	sections := []CurrentModelSection{
		CurrentModelSectionLLM,
		CurrentModelSectionEmbedding,
		CurrentModelSectionVectorStorage,
		CurrentModelSectionImageGeneration,
		CurrentModelSectionASR,
		CurrentModelSectionTTS,
	}
	for _, section := range sections {
		t.Run(string(section), func(t *testing.T) {
			repository := &currentModelCandidateRepositoryStub{}
			defaults := &currentModelDefaultsLoaderStub{}
			service, err := NewCurrentModelCatalogService(repository, defaults)
			if err != nil {
				t.Fatal(err)
			}
			response, err := service.Get(context.Background(), CurrentModelCatalogQuery{
				Section: section, ProjectID: 7, PublicProjectID: 1,
			})
			if err != nil {
				t.Fatal(err)
			}
			if response.Items == nil || len(repository.calls) != 1 || defaults.calls != 1 {
				t.Fatalf("section %q was not orchestrated", section)
			}
		})
	}
}

func TestCurrentModelCatalogServiceDoesNotDuplicatePublicCandidateQuery(t *testing.T) {
	tests := []CurrentModelCatalogQuery{
		{Section: CurrentModelSectionLLM, ProjectID: 7, PublicProjectID: 1, IncludeShared: false},
		{Section: CurrentModelSectionLLM, ProjectID: 1, PublicProjectID: 1, IncludeShared: true},
	}
	for _, query := range tests {
		repository := &currentModelCandidateRepositoryStub{}
		defaults := &currentModelDefaultsLoaderStub{}
		service, err := NewCurrentModelCatalogService(repository, defaults)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.Get(context.Background(), query); err != nil {
			t.Fatal(err)
		}
		if len(repository.calls) != 1 || repository.calls[0].sharedOnly || defaults.calls != 1 {
			t.Fatalf("query=%#v calls=%#v defaults=%d", query, repository.calls, defaults.calls)
		}
	}
}

func TestCurrentModelCatalogServiceRejectsInvalidRequestsBeforeDependencies(t *testing.T) {
	repository := &currentModelCandidateRepositoryStub{}
	defaults := &currentModelDefaultsLoaderStub{}
	service, err := NewCurrentModelCatalogService(repository, defaults)
	if err != nil {
		t.Fatal(err)
	}
	valid := CurrentModelCatalogQuery{Section: CurrentModelSectionLLM, ProjectID: 7, PublicProjectID: 1}
	tests := []struct {
		ctx   context.Context
		query CurrentModelCatalogQuery
	}{
		{ctx: nil, query: valid},
		{ctx: context.Background(), query: CurrentModelCatalogQuery{Section: CurrentModelSectionLLM, ProjectID: 0, PublicProjectID: 1}},
		{ctx: context.Background(), query: CurrentModelCatalogQuery{Section: CurrentModelSectionLLM, ProjectID: 7, PublicProjectID: 0}},
		{ctx: context.Background(), query: CurrentModelCatalogQuery{Section: CurrentModelSection("github"), ProjectID: 7, PublicProjectID: 1}},
	}
	for _, test := range tests {
		_, err := service.Get(test.ctx, test.query)
		if !errors.Is(err, ErrInvalidCurrentModelCatalogRequest) {
			t.Fatalf("query=%#v error=%v", test.query, err)
		}
	}
	if len(repository.calls) != 0 || defaults.calls != 0 {
		t.Fatal("invalid requests reached dependencies")
	}

	if _, err := NewCurrentModelCatalogService(nil, defaults); err == nil {
		t.Fatal("missing candidate repository was accepted")
	}
	if _, err := NewCurrentModelCatalogService(repository, nil); err == nil {
		t.Fatal("missing defaults loader was accepted")
	}
}

func TestCurrentModelCatalogServicePreservesFailureAndCancellation(t *testing.T) {
	dependencyFailure := errors.New("candidate store unavailable")
	repository := &currentModelCandidateRepositoryStub{list: func(
		context.Context, int32, CurrentModelSection, bool,
	) ([]CurrentModelCatalogItem, error) {
		return nil, dependencyFailure
	}}
	defaults := &currentModelDefaultsLoaderStub{}
	service, err := NewCurrentModelCatalogService(repository, defaults)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Get(context.Background(), CurrentModelCatalogQuery{
		Section: CurrentModelSectionLLM, ProjectID: 7, PublicProjectID: 1,
	})
	if !errors.Is(err, dependencyFailure) || defaults.calls != 0 {
		t.Fatalf("dependency error=%v defaults=%d", err, defaults.calls)
	}

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	repository.calls = nil
	_, err = service.Get(canceled, CurrentModelCatalogQuery{
		Section: CurrentModelSectionLLM, ProjectID: 7, PublicProjectID: 1,
	})
	if !errors.Is(err, context.Canceled) || len(repository.calls) != 0 {
		t.Fatalf("pre-canceled request error=%v calls=%#v", err, repository.calls)
	}

	afterList, cancelAfterList := context.WithCancel(context.Background())
	repository.list = func(context.Context, int32, CurrentModelSection, bool) ([]CurrentModelCatalogItem, error) {
		cancelAfterList()
		return []CurrentModelCatalogItem{{Name: "must-not-be-returned", ProjectID: 7}}, nil
	}
	repository.calls = nil
	_, err = service.Get(afterList, CurrentModelCatalogQuery{
		Section: CurrentModelSectionLLM, ProjectID: 7, PublicProjectID: 1,
	})
	if !errors.Is(err, context.Canceled) || defaults.calls != 0 {
		t.Fatalf("mid-flight cancellation error=%v defaults=%d", err, defaults.calls)
	}
}

func TestCurrentModelCatalogServiceReturnsNoPartialResultAfterLaterDependencyFailure(t *testing.T) {
	publicFailure := errors.New("public candidate store unavailable")
	repository := &currentModelCandidateRepositoryStub{list: func(
		_ context.Context, projectID int32, _ CurrentModelSection, sharedOnly bool,
	) ([]CurrentModelCatalogItem, error) {
		if sharedOnly {
			return nil, publicFailure
		}
		return []CurrentModelCatalogItem{{Name: "project", ProjectID: projectID}}, nil
	}}
	defaults := &currentModelDefaultsLoaderStub{}
	service, err := NewCurrentModelCatalogService(repository, defaults)
	if err != nil {
		t.Fatal(err)
	}
	response, err := service.Get(context.Background(), CurrentModelCatalogQuery{
		Section: CurrentModelSectionEmbedding, ProjectID: 7, PublicProjectID: 1, IncludeShared: true,
	})
	if !errors.Is(err, publicFailure) || !reflect.DeepEqual(response, CurrentModelCatalogResponse{}) || defaults.calls != 0 {
		t.Fatalf("public failure response=%#v error=%v defaults=%d", response, err, defaults.calls)
	}

	defaultsFailure := errors.New("model defaults unavailable")
	repository.list = func(_ context.Context, projectID int32, _ CurrentModelSection, _ bool) ([]CurrentModelCatalogItem, error) {
		return []CurrentModelCatalogItem{{Name: "project", ProjectID: projectID}}, nil
	}
	repository.calls = nil
	defaults.load = func(context.Context, int32, int32, CurrentModelSection) (CurrentModelCatalogDefaults, error) {
		return CurrentModelCatalogDefaults{}, defaultsFailure
	}
	response, err = service.Get(context.Background(), CurrentModelCatalogQuery{
		Section: CurrentModelSectionEmbedding, ProjectID: 7, PublicProjectID: 1,
	})
	if !errors.Is(err, defaultsFailure) || !reflect.DeepEqual(response, CurrentModelCatalogResponse{}) || defaults.calls != 1 {
		t.Fatalf("defaults failure response=%#v error=%v defaults=%d", response, err, defaults.calls)
	}
}
