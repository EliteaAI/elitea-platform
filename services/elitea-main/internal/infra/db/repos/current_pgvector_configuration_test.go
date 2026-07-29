package repos

import (
	"context"
	"errors"
	"strings"
	"testing"

	vectorstoreapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/vectorstore"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/jackc/pgx/v5"
)

func TestCurrentProjectPgvectorConfigurationsRepositoryUpsertsExactCurrentRow(t *testing.T) {
	t.Parallel()

	store := &currentConfigurationProjectStore{}
	queries := &currentProjectPgvectorQueriesStub{id: 42}
	repository := newCurrentProjectPgvectorRepositoryForTest(t, store, queries)
	label := "Public PgVector"
	configuration := validCurrentProjectPgvectorConfigurationForTest(42)
	configuration.Label = &label

	configurationID, err := repository.UpsertProjectPgvectorConfiguration(context.Background(), configuration)
	if err != nil || configurationID != 42 {
		t.Fatalf("UpsertProjectPgvectorConfiguration() id=%d error=%v", configurationID, err)
	}
	if len(store.projectIDs) != 1 || store.projectIDs[0] != 42 || len(store.options) != 1 ||
		store.options[0].IsoLevel != pgx.ReadCommitted || store.options[0].AccessMode != pgx.ReadWrite {
		t.Fatalf("tenant transaction = projects %#v options %#v", store.projectIDs, store.options)
	}
	if queries.params.ConfigurationUuid != configuration.UUID || queries.params.ProjectID != 42 ||
		queries.params.EliteaTitle != vectorstoreapp.DefaultProjectPgvectorTitle ||
		queries.params.Label == nil || *queries.params.Label != label {
		t.Fatalf("generated query params = %+v", queries.params)
	}
	label = "mutated"
	if *queries.params.Label != "Public PgVector" {
		t.Fatalf("query label aliases caller: %q", *queries.params.Label)
	}
}

func TestCurrentProjectPgvectorConfigurationsRepositoryRejectsContractDrift(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		mutate func(*vectorstoreapp.ProjectConfiguration)
	}{
		{name: "project", mutate: func(value *vectorstoreapp.ProjectConfiguration) { value.ProjectID = 0 }},
		{name: "uuid", mutate: func(value *vectorstoreapp.ProjectConfiguration) { value.UUID = "not-a-uuid" }},
		{name: "title", mutate: func(value *vectorstoreapp.ProjectConfiguration) { value.Title = "" }},
		{name: "type", mutate: func(value *vectorstoreapp.ProjectConfiguration) { value.Type = "github" }},
		{name: "section", mutate: func(value *vectorstoreapp.ProjectConfiguration) { value.Section = "credentials" }},
		{name: "source", mutate: func(value *vectorstoreapp.ProjectConfiguration) { value.Source = "user" }},
		{name: "reference", mutate: func(value *vectorstoreapp.ProjectConfiguration) { value.ConnectionStringReference = "plaintext" }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &currentConfigurationProjectStore{}
			queries := &currentProjectPgvectorQueriesStub{id: 1}
			repository := newCurrentProjectPgvectorRepositoryForTest(t, store, queries)
			configuration := validCurrentProjectPgvectorConfigurationForTest(1)
			test.mutate(&configuration)

			_, err := repository.UpsertProjectPgvectorConfiguration(context.Background(), configuration)
			if !errors.Is(err, vectorstoreapp.ErrInvalidProjectPgvectorRequest) {
				t.Fatalf("error = %v", err)
			}
			if len(store.projectIDs) != 0 || queries.calls != 0 {
				t.Fatalf("invalid input reached database: projects=%#v calls=%d", store.projectIDs, queries.calls)
			}
		})
	}
}

func TestCurrentProjectPgvectorConfigurationsRepositoryMapsFailuresAndCancellation(t *testing.T) {
	t.Parallel()

	queries := &currentProjectPgvectorQueriesStub{err: errors.New("database-secret-canary")}
	repository := newCurrentProjectPgvectorRepositoryForTest(t, &currentConfigurationProjectStore{}, queries)
	_, err := repository.UpsertProjectPgvectorConfiguration(
		context.Background(),
		validCurrentProjectPgvectorConfigurationForTest(7),
	)
	if !errors.Is(err, vectorstoreapp.ErrProjectPgvectorConfiguration) || strings.Contains(err.Error(), "database-secret-canary") {
		t.Fatalf("database error = %v", err)
	}

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = repository.UpsertProjectPgvectorConfiguration(
		canceled,
		validCurrentProjectPgvectorConfigurationForTest(7),
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation error = %v", err)
	}
}

func TestCurrentProjectPgvectorConfigurationsRepositoryReturnsTypedIdentityConflict(t *testing.T) {
	t.Parallel()

	repository := newCurrentProjectPgvectorRepositoryForTest(
		t,
		&currentConfigurationProjectStore{},
		&currentProjectPgvectorQueriesStub{err: pgx.ErrNoRows},
	)
	_, err := repository.UpsertProjectPgvectorConfiguration(
		context.Background(),
		validCurrentProjectPgvectorConfigurationForTest(7),
	)
	if !errors.Is(err, vectorstoreapp.ErrProjectPgvectorConflict) {
		t.Fatalf("conflict error = %v", err)
	}
}

func newCurrentProjectPgvectorRepositoryForTest(
	t *testing.T,
	store projectStore,
	queries currentProjectPgvectorQueries,
) *CurrentProjectPgvectorConfigurationsRepository {
	t.Helper()
	repository, err := newCurrentProjectPgvectorConfigurationsRepository(
		store,
		func(sqlExecutor) (currentProjectPgvectorQueries, error) { return queries, nil },
	)
	if err != nil {
		t.Fatal(err)
	}
	return repository
}

func validCurrentProjectPgvectorConfigurationForTest(projectID int32) vectorstoreapp.ProjectConfiguration {
	return vectorstoreapp.ProjectConfiguration{
		UUID:                      "00000000-0000-4000-8000-000000000042",
		ProjectID:                 projectID,
		Title:                     vectorstoreapp.DefaultProjectPgvectorTitle,
		Type:                      vectorstoreapp.ProjectPgvectorType,
		Section:                   vectorstoreapp.ProjectPgvectorSection,
		Source:                    vectorstoreapp.ProjectPgvectorSource,
		ConnectionStringReference: vectorstoreapp.ProjectPgvectorReference,
	}
}

type currentProjectPgvectorQueriesStub struct {
	id     int32
	err    error
	params sqlcgen.UpsertCurrentProjectPgvectorConfigurationParams
	calls  int
}

func (s *currentProjectPgvectorQueriesStub) UpsertCurrentProjectPgvectorConfiguration(
	_ context.Context,
	params sqlcgen.UpsertCurrentProjectPgvectorConfigurationParams,
) (int32, error) {
	s.calls++
	s.params = params
	return s.id, s.err
}
