package configurations

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCurrentDeletedLLMReferenceEffectSkipsRepairWhileBareNameRemainsAvailable(t *testing.T) {
	projects := &currentDeletedLLMProjectsStub{}
	catalog := &currentDeletedLLMCatalogStub{responses: map[int32]CurrentModelCatalogResponse{
		7: {
			Items: []CurrentModelCatalogItem{{Name: "deleted-model", ProjectID: 1, Shared: true}},
		},
	}}
	applications := &currentDeletedLLMApplicationsStub{}
	effect := currentDeletedLLMReferenceEffectForTest(t, projects, catalog, applications, 1)

	if err := effect.RepairCurrentDeletedLLMReferences(context.Background(), currentDeletedLLMTestEffect(7)); err != nil {
		t.Fatalf("RepairCurrentDeletedLLMReferences() error = %v", err)
	}
	if projects.calls != 0 {
		t.Fatalf("active-project list calls = %d", projects.calls)
	}
	if got := applications.callSnapshot(); len(got) != 0 {
		t.Fatalf("application replacements = %#v", got)
	}
}

func TestCurrentDeletedLLMReferenceEffectReplacesWithCurrentCatalogDefault(t *testing.T) {
	projects := &currentDeletedLLMProjectsStub{}
	defaultName := "fallback-model"
	defaultProjectID := int32(1)
	catalog := &currentDeletedLLMCatalogStub{responses: map[int32]CurrentModelCatalogResponse{
		7: {
			Items:                 []CurrentModelCatalogItem{{Name: defaultName, ProjectID: defaultProjectID}},
			DefaultModelName:      &defaultName,
			DefaultModelProjectID: &defaultProjectID,
		},
	}}
	applications := &currentDeletedLLMApplicationsStub{updated: 3}
	effect := currentDeletedLLMReferenceEffectForTest(t, projects, catalog, applications, 1)

	if err := effect.RepairCurrentDeletedLLMReferences(context.Background(), currentDeletedLLMTestEffect(7)); err != nil {
		t.Fatalf("RepairCurrentDeletedLLMReferences() error = %v", err)
	}
	calls := applications.callSnapshot()
	if len(calls) != 1 || calls[0] != (CurrentDeletedLLMReferenceReplacement{
		ProjectID:             7,
		DeletedModelName:      "deleted-model",
		DefaultModelName:      defaultName,
		DefaultModelProjectID: defaultProjectID,
		MaxRows:               MaxCurrentDeletedLLMApplicationVersions,
	}) {
		t.Fatalf("application replacements = %#v", calls)
	}
}

func TestCurrentDeletedLLMReferenceEffectPublicDeleteFansOutWithBoundedConcurrency(t *testing.T) {
	projectIDs := []int32{10, 9, 8, 7, 6, 5, 4, 3, 2, 2}
	projects := &currentDeletedLLMProjectsStub{ids: projectIDs}
	defaultName := "fallback-model"
	defaultProjectID := int32(1)
	catalog := &currentDeletedLLMCatalogStub{
		fallback: CurrentModelCatalogResponse{
			Items:                 []CurrentModelCatalogItem{{Name: defaultName, ProjectID: defaultProjectID}},
			DefaultModelName:      &defaultName,
			DefaultModelProjectID: &defaultProjectID,
		},
		entered: make(chan int32, len(projectIDs)+1),
		release: make(chan struct{}),
	}
	applications := &currentDeletedLLMApplicationsStub{}
	effect := currentDeletedLLMReferenceEffectForTest(t, projects, catalog, applications, 1)

	done := make(chan error, 1)
	go func() {
		done <- effect.RepairCurrentDeletedLLMReferences(context.Background(), currentDeletedLLMTestEffect(1))
	}()

	for index := 0; index < MaxCurrentDeletedLLMConcurrency; index++ {
		select {
		case <-catalog.entered:
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for bounded workers")
		}
	}
	select {
	case projectID := <-catalog.entered:
		t.Fatalf("project %d started above concurrency bound", projectID)
	default:
	}
	close(catalog.release)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("RepairCurrentDeletedLLMReferences() error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for public-project repair")
	}

	if projects.maxRows != MaxCurrentDeletedLLMProjects+1 {
		t.Fatalf("active-project max rows = %d", projects.maxRows)
	}
	if catalog.maxConcurrencySnapshot() > MaxCurrentDeletedLLMConcurrency {
		t.Fatalf("max concurrency = %d", catalog.maxConcurrencySnapshot())
	}
	queries := catalog.querySnapshot()
	if len(queries) != 10 {
		t.Fatalf("catalog query count = %d, queries = %#v", len(queries), queries)
	}
	for _, query := range queries {
		if query.Section != CurrentModelSectionLLM || query.PublicProjectID != 1 || !query.IncludeShared {
			t.Fatalf("catalog query = %#v", query)
		}
	}
	calls := applications.callSnapshot()
	if len(calls) != 10 {
		t.Fatalf("application replacement count = %d, calls = %#v", len(calls), calls)
	}
	seen := make(map[int32]struct{}, len(calls))
	for _, call := range calls {
		seen[call.ProjectID] = struct{}{}
	}
	for projectID := int32(1); projectID <= 10; projectID++ {
		if _, ok := seen[projectID]; !ok {
			t.Fatalf("project %d was not repaired: %#v", projectID, calls)
		}
	}
}

func TestCurrentDeletedLLMReferenceEffectFailsSafelyWhenNoDefaultExists(t *testing.T) {
	projects := &currentDeletedLLMProjectsStub{}
	catalog := &currentDeletedLLMCatalogStub{responses: map[int32]CurrentModelCatalogResponse{
		7: {Items: []CurrentModelCatalogItem{}},
	}}
	applications := &currentDeletedLLMApplicationsStub{}
	effect := currentDeletedLLMReferenceEffectForTest(t, projects, catalog, applications, 1)

	err := effect.RepairCurrentDeletedLLMReferences(context.Background(), currentDeletedLLMTestEffect(7))
	if !errors.Is(err, ErrCurrentDeletedLLMDefaultUnavailable) {
		t.Fatalf("missing-default error = %v", err)
	}
	if got := applications.callSnapshot(); len(got) != 0 {
		t.Fatalf("application replacements = %#v", got)
	}
}

func TestCurrentDeletedLLMReferenceEffectEnforcesProjectAndApplicationBounds(t *testing.T) {
	t.Run("projects", func(t *testing.T) {
		projects := &currentDeletedLLMProjectsStub{
			ids: make([]int32, MaxCurrentDeletedLLMProjects+1),
		}
		effect := currentDeletedLLMReferenceEffectForTest(
			t,
			projects,
			&currentDeletedLLMCatalogStub{},
			&currentDeletedLLMApplicationsStub{},
			1,
		)
		err := effect.RepairCurrentDeletedLLMReferences(context.Background(), currentDeletedLLMTestEffect(1))
		if !errors.Is(err, ErrCurrentConfigurationLifecycleInternalLimit) {
			t.Fatalf("project overflow error = %v", err)
		}
	})

	t.Run("application versions", func(t *testing.T) {
		defaultName := "fallback"
		defaultProjectID := int32(1)
		effect := currentDeletedLLMReferenceEffectForTest(
			t,
			&currentDeletedLLMProjectsStub{},
			&currentDeletedLLMCatalogStub{fallback: CurrentModelCatalogResponse{
				Items:                 []CurrentModelCatalogItem{{Name: defaultName, ProjectID: defaultProjectID}},
				DefaultModelName:      &defaultName,
				DefaultModelProjectID: &defaultProjectID,
			}},
			&currentDeletedLLMApplicationsStub{updated: MaxCurrentDeletedLLMApplicationVersions + 1},
			1,
		)
		err := effect.RepairCurrentDeletedLLMReferences(context.Background(), currentDeletedLLMTestEffect(7))
		if !errors.Is(err, ErrCurrentConfigurationLifecycleInternalLimit) {
			t.Fatalf("application overflow error = %v", err)
		}
	})
}

func TestCurrentDeletedLLMReferenceEffectRedactsDependenciesAndPreservesCancellation(t *testing.T) {
	projects := &currentDeletedLLMProjectsStub{}
	catalog := &currentDeletedLLMCatalogStub{errors: map[int32]error{
		7: errors.New("catalog token=must-not-leak"),
	}}
	effect := currentDeletedLLMReferenceEffectForTest(
		t,
		projects,
		catalog,
		&currentDeletedLLMApplicationsStub{},
		1,
	)
	err := effect.RepairCurrentDeletedLLMReferences(context.Background(), currentDeletedLLMTestEffect(7))
	if !errors.Is(err, ErrCurrentConfigurationLifecycleInternalUnavailable) || strings.Contains(err.Error(), "must-not-leak") {
		t.Fatalf("dependency error = %v", err)
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	err = effect.RepairCurrentDeletedLLMReferences(cancelled, currentDeletedLLMTestEffect(7))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation error = %v", err)
	}
}

func TestCurrentDeletedLLMReferenceEffectRejectsInvalidDependenciesAndEffect(t *testing.T) {
	catalog := &currentDeletedLLMCatalogStub{}
	applications := &currentDeletedLLMApplicationsStub{}
	projects := &currentDeletedLLMProjectsStub{}
	constructors := []func() error{
		func() error { _, err := NewCurrentDeletedLLMReferenceEffect(nil, catalog, applications, 1); return err },
		func() error {
			_, err := NewCurrentDeletedLLMReferenceEffect(projects, nil, applications, 1)
			return err
		},
		func() error { _, err := NewCurrentDeletedLLMReferenceEffect(projects, catalog, nil, 1); return err },
		func() error {
			_, err := NewCurrentDeletedLLMReferenceEffect(projects, catalog, applications, 0)
			return err
		},
	}
	for index, constructor := range constructors {
		if err := constructor(); !errors.Is(err, ErrInvalidCurrentConfigurationLifecycleInternalEffect) {
			t.Fatalf("constructor %d error = %v", index, err)
		}
	}

	effect := currentDeletedLLMReferenceEffectForTest(t, projects, catalog, applications, 1)
	invalid := currentDeletedLLMTestEffect(7)
	invalid.ModelName = ""
	if err := effect.RepairCurrentDeletedLLMReferences(context.Background(), invalid); !errors.Is(err, ErrInvalidCurrentConfigurationLifecycleInternalEffect) {
		t.Fatalf("invalid effect error = %v", err)
	}
}

func currentDeletedLLMReferenceEffectForTest(
	t *testing.T,
	projects CurrentDeletedLLMProjectRepository,
	catalog CurrentDeletedLLMModelCatalog,
	applications CurrentDeletedLLMApplicationRepository,
	publicProjectID int32,
) *CurrentDeletedLLMReferenceEffect {
	t.Helper()
	effect, err := NewCurrentDeletedLLMReferenceEffect(projects, catalog, applications, publicProjectID)
	if err != nil {
		t.Fatalf("NewCurrentDeletedLLMReferenceEffect() error = %v", err)
	}
	return effect
}

func currentDeletedLLMTestEffect(projectID int32) CurrentDeletedLLMEffect {
	return CurrentDeletedLLMEffect{
		EffectID:  "event-1:dependents:deleted-llm",
		EventID:   "event-1",
		Revision:  4,
		ProjectID: projectID,
		ModelName: "deleted-model",
	}
}

type currentDeletedLLMProjectsStub struct {
	ids     []int32
	err     error
	calls   int
	maxRows int
}

func (s *currentDeletedLLMProjectsStub) ListActiveCurrentProjectIDs(
	_ context.Context,
	maxRows int,
) ([]int32, error) {
	s.calls++
	s.maxRows = maxRows
	return append([]int32(nil), s.ids...), s.err
}

type currentDeletedLLMCatalogStub struct {
	mu            sync.Mutex
	responses     map[int32]CurrentModelCatalogResponse
	errors        map[int32]error
	fallback      CurrentModelCatalogResponse
	queries       []CurrentModelCatalogQuery
	entered       chan int32
	release       chan struct{}
	active        int
	maxConcurrent int
}

func (s *currentDeletedLLMCatalogStub) Get(
	ctx context.Context,
	query CurrentModelCatalogQuery,
) (CurrentModelCatalogResponse, error) {
	s.mu.Lock()
	s.queries = append(s.queries, query)
	s.active++
	if s.active > s.maxConcurrent {
		s.maxConcurrent = s.active
	}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.active--
		s.mu.Unlock()
	}()

	if s.entered != nil {
		select {
		case s.entered <- query.ProjectID:
		case <-ctx.Done():
			return CurrentModelCatalogResponse{}, ctx.Err()
		}
	}
	if s.release != nil {
		select {
		case <-s.release:
		case <-ctx.Done():
			return CurrentModelCatalogResponse{}, ctx.Err()
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.errors[query.ProjectID]; err != nil {
		return CurrentModelCatalogResponse{}, err
	}
	if response, ok := s.responses[query.ProjectID]; ok {
		return response, nil
	}
	return s.fallback, nil
}

func (s *currentDeletedLLMCatalogStub) maxConcurrencySnapshot() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.maxConcurrent
}

func (s *currentDeletedLLMCatalogStub) querySnapshot() []CurrentModelCatalogQuery {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]CurrentModelCatalogQuery(nil), s.queries...)
}

type currentDeletedLLMApplicationsStub struct {
	mu      sync.Mutex
	calls   []CurrentDeletedLLMReferenceReplacement
	updated int
	err     error
}

func (s *currentDeletedLLMApplicationsStub) ReplaceCurrentDeletedLLMApplicationReferences(
	_ context.Context,
	replacement CurrentDeletedLLMReferenceReplacement,
) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, replacement)
	return s.updated, s.err
}

func (s *currentDeletedLLMApplicationsStub) callSnapshot() []CurrentDeletedLLMReferenceReplacement {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]CurrentDeletedLLMReferenceReplacement(nil), s.calls...)
}

var _ CurrentDeletedLLMProjectRepository = (*currentDeletedLLMProjectsStub)(nil)
var _ CurrentDeletedLLMModelCatalog = (*currentDeletedLLMCatalogStub)(nil)
var _ CurrentDeletedLLMApplicationRepository = (*currentDeletedLLMApplicationsStub)(nil)
