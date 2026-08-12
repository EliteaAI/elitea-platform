package runtimecomposition

import (
	"context"
	"errors"
	"testing"
	"time"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	indexmetaapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexmeta"
	indexscheduleapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexschedule"
)

type scheduledFailureToolkitReader struct {
	requestedUserID int32
}

func (reader *scheduledFailureToolkitReader) GetCurrentToolkit(
	_ context.Context,
	projectID, userID, toolkitID int32,
) (indexingapp.CurrentToolkitSnapshot, bool, error) {
	reader.requestedUserID = userID
	return indexingapp.CurrentToolkitSnapshot{
		ID:   toolkitID,
		Type: "github",
		Settings: map[string]any{
			"pgvector_configuration": map[string]any{
				"private":      true,
				"elitea_title": "Project vector store",
			},
		},
	}, projectID == 7 && toolkitID == 19, nil
}

type scheduledFailureSettingsResolver struct {
	request configurationapp.CurrentToolkitSettingsRequest
}

func (resolver *scheduledFailureSettingsResolver) Resolve(
	_ context.Context,
	request configurationapp.CurrentToolkitSettingsRequest,
) (map[string]any, error) {
	resolver.request = request
	return map[string]any{
		"pgvector_configuration": map[string]any{
			"connection_string": "postgres://redacted@vector/project",
		},
	}, nil
}

type scheduledFailureHistory struct {
	target indexmetaapp.ResolvedTarget
	effect indexscheduleapp.FailureEffect
	err    error
}

func (history *scheduledFailureHistory) MaterializeScheduledFailure(
	_ context.Context,
	target indexmetaapp.ResolvedTarget,
	effect indexscheduleapp.FailureEffect,
) error {
	history.target = target
	history.effect = effect
	return history.err
}

type scheduledFailureNotifications struct {
	effect indexscheduleapp.FailureEffect
	calls  int
}

func (notifications *scheduledFailureNotifications) Persist(
	_ context.Context,
	effect indexscheduleapp.FailureEffect,
) error {
	notifications.calls++
	notifications.effect = effect
	return nil
}

func TestCurrentIndexScheduleFailureUsesCreatorAndStableOccurrenceIdentity(
	t *testing.T,
) {
	toolkits := &scheduledFailureToolkitReader{}
	settings := &scheduledFailureSettingsResolver{}
	history := &scheduledFailureHistory{}
	notifications := &scheduledFailureNotifications{}
	actualFailureTime := time.Date(2026, 7, 30, 15, 4, 5, 0, time.UTC)
	recorder, err := newCurrentIndexScheduleFailureRecorderWithClock(
		toolkits,
		settings,
		history,
		notifications,
		func() time.Time { return actualFailureTime },
	)
	if err != nil {
		t.Fatal(err)
	}
	candidate := indexscheduleapp.Candidate{
		ProjectID:      7,
		ToolkitID:      19,
		ToolkitType:    "github",
		IndexMetaID:    "docs",
		ScheduleUserID: -1,
		Schedule: indexscheduleapp.Schedule{
			CreatedBy: 11,
		},
	}
	occurrence := time.Date(2026, 7, 30, 15, 0, 0, 0, time.UTC)
	if err := recorder.RecordScheduleFailure(
		context.Background(),
		candidate,
		"missing valid user token",
		occurrence,
	); err != nil {
		t.Fatal(err)
	}

	if toolkits.requestedUserID != 11 ||
		settings.request.UserID != 11 ||
		settings.request.ProjectID != 7 ||
		settings.request.Mode != configurationapp.CurrentToolkitSettingsClaimMode {
		t.Fatalf(
			"creator scope drift: toolkit user=%d settings=%+v",
			toolkits.requestedUserID,
			settings.request,
		)
	}
	wantEffectID := indexscheduleapp.StableIdempotencyKey(candidate, occurrence)
	if history.effect.EffectID != wantEffectID ||
		notifications.effect.EffectID != wantEffectID ||
		history.effect.UserID != 11 ||
		!history.effect.OccurredAt.Equal(actualFailureTime) ||
		history.target.SchemaID != 19 ||
		notifications.calls != 1 {
		t.Fatalf(
			"history=%+v notification=%+v target=%+v calls=%d",
			history.effect,
			notifications.effect,
			history.target,
			notifications.calls,
		)
	}
}

func TestCurrentIndexScheduleFailureDoesNotNotifyBeforeHistoryIsDurable(
	t *testing.T,
) {
	historyFailure := errors.New("history unavailable")
	history := &scheduledFailureHistory{err: historyFailure}
	notifications := &scheduledFailureNotifications{}
	recorder, err := newCurrentIndexScheduleFailureRecorderWithClock(
		&scheduledFailureToolkitReader{},
		&scheduledFailureSettingsResolver{},
		history,
		notifications,
		time.Now,
	)
	if err != nil {
		t.Fatal(err)
	}
	candidate := indexscheduleapp.Candidate{
		ProjectID: 7, ToolkitID: 19, ToolkitType: "github",
		IndexMetaID: "docs", ScheduleUserID: 11,
		Schedule: indexscheduleapp.Schedule{
			CreatedBy: 11,
		},
	}
	err = recorder.RecordScheduleFailure(
		context.Background(),
		candidate,
		"toolkit credentials resolving issue",
		time.Now().UTC(),
	)
	if !errors.Is(err, historyFailure) || notifications.calls != 0 {
		t.Fatalf("error=%v notification calls=%d", err, notifications.calls)
	}
}
