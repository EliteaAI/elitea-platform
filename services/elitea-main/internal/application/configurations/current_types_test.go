package configurations

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

type currentConfigurationTypesRepositoryStub struct {
	list   func(context.Context, CurrentConfigurationTypesFilter) ([]string, error)
	filter CurrentConfigurationTypesFilter
	calls  int
}

func (stub *currentConfigurationTypesRepositoryStub) ListDistinctTypes(
	ctx context.Context,
	filter CurrentConfigurationTypesFilter,
) ([]string, error) {
	stub.calls++
	stub.filter = filter
	if stub.list == nil {
		return nil, nil
	}
	return stub.list(ctx, filter)
}

func TestCurrentConfigurationTypesServiceReturnsBoundedDistinctSortedRows(t *testing.T) {
	repository := &currentConfigurationTypesRepositoryStub{
		list: func(_ context.Context, filter CurrentConfigurationTypesFilter) ([]string, error) {
			if filter.ProjectID != 7 || filter.Section != "credentials" ||
				filter.MaxRows != MaxCurrentConfigurationTypes+1 {
				t.Fatalf("unexpected repository filter: %+v", filter)
			}
			return []string{"gitlab", "github", "gitlab"}, nil
		},
	}
	service, err := NewCurrentConfigurationTypesService(repository)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.List(context.Background(), CurrentConfigurationTypesQuery{
		ProjectID: 7,
		Section:   "credentials",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result.Rows, []string{"github", "gitlab"}) || result.Total != 2 {
		t.Fatalf("result=%+v", result)
	}
}

func TestCurrentConfigurationTypesServicePreservesExplicitEmptySectionAndEmptyRows(t *testing.T) {
	repository := &currentConfigurationTypesRepositoryStub{}
	service, err := NewCurrentConfigurationTypesService(repository)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.List(context.Background(), CurrentConfigurationTypesQuery{ProjectID: 7})
	if err != nil {
		t.Fatal(err)
	}
	if repository.filter.Section != "" {
		t.Fatalf("section=%q, want no predicate", repository.filter.Section)
	}
	if result.Rows == nil || len(result.Rows) != 0 || result.Total != 0 {
		t.Fatalf("empty result=%+v", result)
	}
}

func TestCurrentConfigurationTypesServiceRejectsInvalidInputBeforeRepository(t *testing.T) {
	repository := &currentConfigurationTypesRepositoryStub{}
	service, err := NewCurrentConfigurationTypesService(repository)
	if err != nil {
		t.Fatal(err)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()

	tests := []struct {
		name  string
		ctx   context.Context
		query CurrentConfigurationTypesQuery
		want  error
	}{
		{name: "nil context", query: CurrentConfigurationTypesQuery{ProjectID: 7}, want: ErrInvalidCurrentConfigurationTypesRequest},
		{name: "invalid project", ctx: context.Background(), query: CurrentConfigurationTypesQuery{}, want: ErrInvalidCurrentConfigurationTypesRequest},
		{name: "section too long", ctx: context.Background(), query: CurrentConfigurationTypesQuery{ProjectID: 7, Section: strings.Repeat("x", MaxCurrentConfigurationTypeLength+1)}, want: ErrInvalidCurrentConfigurationTypesRequest},
		{name: "canceled", ctx: canceled, query: CurrentConfigurationTypesQuery{ProjectID: 7}, want: context.Canceled},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := service.List(test.ctx, test.query); !errors.Is(err, test.want) {
				t.Fatalf("error=%v, want %v", err, test.want)
			}
		})
	}
	if repository.calls != 0 {
		t.Fatalf("invalid requests reached repository %d times", repository.calls)
	}
}

func TestCurrentConfigurationTypesServiceFailsClosedOnRepositoryAndResponseBounds(t *testing.T) {
	dependencyFailure := errors.New("database contains protected detail")
	tests := []struct {
		name string
		rows []string
		err  error
	}{
		{name: "repository failure", err: dependencyFailure},
		{name: "repository violates row bound", rows: make([]string, MaxCurrentConfigurationTypes+2)},
		{name: "too many distinct values", rows: numberedCurrentConfigurationTypes(MaxCurrentConfigurationTypes + 1)},
		{name: "type too long", rows: []string{strings.Repeat("x", MaxCurrentConfigurationTypeLength+1)}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repository := &currentConfigurationTypesRepositoryStub{
				list: func(context.Context, CurrentConfigurationTypesFilter) ([]string, error) {
					return test.rows, test.err
				},
			}
			service, err := NewCurrentConfigurationTypesService(repository)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := service.List(context.Background(), CurrentConfigurationTypesQuery{ProjectID: 7}); err == nil {
				t.Fatal("expected bounded failure")
			} else if test.err != nil && !errors.Is(err, dependencyFailure) {
				t.Fatalf("dependency error identity lost: %v", err)
			}
		})
	}
}

func TestCurrentConfigurationTypesServiceAllowsExactResponseBound(t *testing.T) {
	repository := &currentConfigurationTypesRepositoryStub{
		list: func(context.Context, CurrentConfigurationTypesFilter) ([]string, error) {
			return numberedCurrentConfigurationTypes(MaxCurrentConfigurationTypes), nil
		},
	}
	service, err := NewCurrentConfigurationTypesService(repository)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.List(context.Background(), CurrentConfigurationTypesQuery{ProjectID: 7})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != MaxCurrentConfigurationTypes || len(result.Rows) != MaxCurrentConfigurationTypes {
		t.Fatalf("exact-bound result total=%d rows=%d", result.Total, len(result.Rows))
	}
}

func TestNewCurrentConfigurationTypesServiceRequiresRepository(t *testing.T) {
	if _, err := NewCurrentConfigurationTypesService(nil); err == nil {
		t.Fatal("expected constructor failure")
	}
}

func numberedCurrentConfigurationTypes(count int) []string {
	result := make([]string, count)
	for index := range result {
		result[index] = string(rune(index + 1))
	}
	return result
}
