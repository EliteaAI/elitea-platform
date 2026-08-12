package social

import (
	"context"
	"errors"
	"testing"
	"time"
)

type currentAuthorsRepositoryStub struct {
	list  func(context.Context, int32) ([]CurrentAuthor, error)
	calls int
}

func (stub *currentAuthorsRepositoryStub) ListCurrentProjectAuthors(
	ctx context.Context,
	projectID int32,
) ([]CurrentAuthor, error) {
	stub.calls++
	if stub.list == nil {
		return nil, nil
	}
	return stub.list(ctx, projectID)
}

func TestCurrentAuthorsServicePreservesRowsAndNormalizesEmptyResult(t *testing.T) {
	t.Parallel()

	lastLogin := time.Date(2026, time.July, 27, 8, 9, 10, 0, time.UTC)
	email := "member@example.test"
	repository := &currentAuthorsRepositoryStub{
		list: func(ctx context.Context, projectID int32) ([]CurrentAuthor, error) {
			if ctx == nil || projectID != 7 {
				t.Fatalf("repository input context=%v project=%d", ctx, projectID)
			}
			return []CurrentAuthor{{
				ID:        41,
				Email:     &email,
				LastLogin: &lastLogin,
				Suspended: true,
			}}, nil
		},
	}
	service, err := NewCurrentAuthorsService(repository)
	if err != nil {
		t.Fatal(err)
	}

	authors, err := service.ListCurrentProjectAuthors(context.Background(), 7)
	if err != nil || len(authors) != 1 || authors[0].ID != 41 ||
		authors[0].Email == nil || *authors[0].Email != email ||
		authors[0].LastLogin == nil || !authors[0].LastLogin.Equal(lastLogin) ||
		!authors[0].Suspended {
		t.Fatalf("authors=%+v error=%v", authors, err)
	}

	repository.list = func(context.Context, int32) ([]CurrentAuthor, error) {
		return nil, nil
	}
	authors, err = service.ListCurrentProjectAuthors(context.Background(), 7)
	if err != nil || authors == nil || len(authors) != 0 {
		t.Fatalf("empty authors=%#v error=%v", authors, err)
	}
}

func TestCurrentAuthorsServiceValidatesBeforeRepositoryAndPreservesCancellation(t *testing.T) {
	t.Parallel()

	repository := &currentAuthorsRepositoryStub{}
	service, err := NewCurrentAuthorsService(repository)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name      string
		ctx       context.Context
		projectID int32
		want      error
	}{
		{name: "nil context", projectID: 7, want: ErrInvalidCurrentAuthorsRequest},
		{name: "invalid project", ctx: context.Background(), want: ErrInvalidCurrentAuthorsRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, gotErr := service.ListCurrentProjectAuthors(test.ctx, test.projectID); !errors.Is(gotErr, test.want) {
				t.Fatalf("error=%v want=%v", gotErr, test.want)
			}
		})
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, gotErr := service.ListCurrentProjectAuthors(ctx, 7); !errors.Is(gotErr, context.Canceled) {
		t.Fatalf("cancelled error=%v", gotErr)
	}
	if repository.calls != 0 {
		t.Fatalf("invalid requests reached repository %d times", repository.calls)
	}
}

func TestNewCurrentAuthorsServiceRejectsMissingRepository(t *testing.T) {
	t.Parallel()

	if _, err := NewCurrentAuthorsService(nil); err == nil {
		t.Fatal("expected missing-repository error")
	}
}
