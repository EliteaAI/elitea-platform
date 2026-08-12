package repos

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestCurrentSocialFeedbacksRepositoryInsertsIntoSharedCentryTable(t *testing.T) {
	referrer := "https://elitea.example/app/chat"
	executor := &scriptedExecutor{
		rowResults: []scriptedRow{{values: []any{int64(73)}}},
	}
	repository, err := newCurrentSocialFeedbacksRepository(executor)
	if err != nil {
		t.Fatal(err)
	}

	id, err := repository.CreateCurrentFeedback(
		context.Background(),
		41,
		"current feedback",
		5,
		&referrer,
		"EliteaUI/current",
	)
	if err != nil {
		t.Fatal(err)
	}
	if id != 73 || len(executor.rowCalls) != 1 {
		t.Fatalf("id=%d row_calls=%d", id, len(executor.rowCalls))
	}
	call := executor.rowCalls[0]
	normalizedSQL := strings.Join(strings.Fields(call.sql), " ")
	if normalizedSQL != "INSERT INTO centry.social_feedbacks ( user_id, referrer, description, rating, user_agent ) VALUES ($1, $2, $3, $4, $5) RETURNING id" ||
		strings.Contains(normalizedSQL, "p_") {
		t.Fatalf("unexpected feedback SQL: %s", normalizedSQL)
	}
	if len(call.args) != 5 ||
		call.args[0] != int64(41) ||
		call.args[1] != &referrer ||
		call.args[2] != "current feedback" ||
		call.args[3] != 5 ||
		call.args[4] != "EliteaUI/current" {
		t.Fatalf("feedback args=%#v", call.args)
	}
}

func TestCurrentSocialFeedbacksRepositoryPreservesOptionalReferrerAndErrors(t *testing.T) {
	databaseFailure := errors.New("database unavailable")
	executor := &scriptedExecutor{
		rowResults: []scriptedRow{
			{err: databaseFailure},
			{values: []any{int64(0)}},
		},
	}
	repository, err := newCurrentSocialFeedbacksRepository(executor)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := repository.CreateCurrentFeedback(
		context.Background(),
		41,
		"",
		0,
		nil,
		"",
	); !errors.Is(err, databaseFailure) {
		t.Fatalf("database error=%v", err)
	}
	if len(executor.rowCalls) != 1 || executor.rowCalls[0].args[1] != (*string)(nil) {
		t.Fatalf("optional referrer args=%#v", executor.rowCalls)
	}

	if _, err := repository.CreateCurrentFeedback(
		context.Background(),
		41,
		"",
		0,
		nil,
		"",
	); err == nil {
		t.Fatal("non-positive returned ID was accepted")
	}
}

func TestCurrentSocialFeedbacksRepositoryRejectsInvalidInputsBeforeSQL(t *testing.T) {
	for name, test := range map[string]struct {
		ctx    context.Context
		userID int64
		rating int
	}{
		"nil context":       {userID: 41, rating: 5},
		"invalid user":      {ctx: context.Background(), rating: 5},
		"rating below zero": {ctx: context.Background(), userID: 41, rating: -1},
		"rating above five": {ctx: context.Background(), userID: 41, rating: 6},
		"canceled context":  {ctx: canceledCurrentFeedbackContext(), userID: 41, rating: 5},
	} {
		t.Run(name, func(t *testing.T) {
			executor := &scriptedExecutor{}
			repository, err := newCurrentSocialFeedbacksRepository(executor)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repository.CreateCurrentFeedback(
				test.ctx,
				test.userID,
				"feedback",
				test.rating,
				nil,
				"",
			); err == nil {
				t.Fatal("invalid feedback was accepted")
			}
			if len(executor.rowCalls) != 0 {
				t.Fatalf("invalid feedback issued %d SQL calls", len(executor.rowCalls))
			}
		})
	}

	if _, err := newCurrentSocialFeedbacksRepository(nil); err == nil {
		t.Fatal("nil SQL store was accepted")
	}
	if _, err := NewCurrentSocialFeedbacksRepository(nil); err == nil {
		t.Fatal("nil PostgreSQL pool was accepted")
	}
}

func canceledCurrentFeedbackContext() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return ctx
}
