package repos

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
)

type currentLLMScopeQueriesStub struct {
	params sqlcgen.IsCurrentUserProjectMemberParams
	member bool
	err    error
}

func (stub *currentLLMScopeQueriesStub) IsCurrentUserProjectMember(
	_ context.Context,
	params sqlcgen.IsCurrentUserProjectMemberParams,
) (bool, error) {
	stub.params = params
	return stub.member, stub.err
}

func TestCurrentLLMScopeUsesTypedCurrentMembershipQuery(t *testing.T) {
	queries := &currentLLMScopeQueriesStub{member: true}
	repository, err := newCurrentLLMScopeRepository(queries)
	if err != nil {
		t.Fatal(err)
	}

	member, err := repository.IsCurrentProjectMember(context.Background(), 11, 7)
	if err != nil || !member || queries.params.UserID != 11 || queries.params.ProjectID != 7 {
		t.Fatalf("member=%t err=%v params=%+v", member, err, queries.params)
	}

	dependencyErr := errors.New("database unavailable")
	queries.err = dependencyErr
	if _, err := repository.IsCurrentProjectMember(context.Background(), 11, 7); !errors.Is(err, dependencyErr) {
		t.Fatalf("dependency error = %v", err)
	}
}

func TestCurrentLLMScopeRejectsInvalidIdentityBeforeQuery(t *testing.T) {
	queries := &currentLLMScopeQueriesStub{member: true}
	repository, err := newCurrentLLMScopeRepository(queries)
	if err != nil {
		t.Fatal(err)
	}

	for _, values := range [][2]int64{{0, 7}, {11, 0}, {math.MaxInt32 + 1, 7}, {11, math.MaxInt32 + 1}} {
		if member, err := repository.IsCurrentProjectMember(context.Background(), values[0], values[1]); member || !errors.Is(err, ErrInvalidCurrentLLMScope) {
			t.Fatalf("ids=%v member=%t err=%v", values, member, err)
		}
	}
	if queries.params != (sqlcgen.IsCurrentUserProjectMemberParams{}) {
		t.Fatalf("invalid input reached query: %+v", queries.params)
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := repository.IsCurrentProjectMember(cancelled, 11, 7); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel error = %v", err)
	}
	if _, err := newCurrentLLMScopeRepository(nil); !errors.Is(err, ErrInvalidCurrentLLMScope) {
		t.Fatalf("nil dependency error = %v", err)
	}
}
