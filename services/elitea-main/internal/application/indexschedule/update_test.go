package indexschedule

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestValidateUpdateCronMatchesCurrentSpecialAndDailyContracts(t *testing.T) {
	t.Parallel()
	for _, value := range []string{
		"0 3 * * *",
		"0 0 L * *",
		"0 0 * * MON#2",
		"0 0 * * MON-FRI#2",
		"0 0 * * MON#2,TUE#2",
		"0 0 * * MON,MON#2",
		"0 0 * * FRI,L5",
		"0 0 * * L7",
		"0 0 * * 7",
		"0 0 * * FRI-SUN",
		"0 0 * * MON/2",
		"0 0 L,1 * *",
		"0 0 29 2 *",
		"0 0 * JAN MON",
		"0 0 * * * 0",
		"@daily",
		"@annually",
	} {
		value := value
		t.Run(value, func(t *testing.T) {
			t.Parallel()
			got, err := ValidateUpdateCron("  " + value + "  ")
			if err != nil || got != value {
				t.Fatalf("ValidateUpdateCron() = %q, %v", got, err)
			}
		})
	}
	for _, test := range []struct {
		value string
		want  error
	}{
		{value: "0 2,14 * * *", want: ErrFrequencyAboveDaily},
		{value: "*/30 * * * *", want: ErrFrequencyAboveDaily},
		{value: "0 0 * * * */30", want: ErrFrequencyAboveDaily},
		{value: "not a cron", want: ErrInvalidCron},
		{value: "@every 24h", want: ErrInvalidCron},
		{value: "0 0 * * 1-5#2", want: ErrInvalidCron},
		{value: "0 0 * * MON#2,TUE", want: ErrInvalidCron},
		{value: "0 0 31 2 *", want: ErrInvalidCron},
		{value: "0 0 ? * *", want: ErrInvalidCron},
		{value: "0 0 * * ?", want: ErrInvalidCron},
	} {
		test := test
		t.Run(test.value, func(t *testing.T) {
			t.Parallel()
			_, err := ValidateUpdateCron(test.value)
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestSpecialCronNextMatchesCurrentCalendarSemantics(t *testing.T) {
	t.Parallel()
	tests := []struct {
		value string
		base  time.Time
		want  time.Time
	}{
		{
			value: "0 0 L * *",
			base:  time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC),
			want:  time.Date(2024, time.January, 31, 0, 0, 0, 0, time.UTC),
		},
		{
			value: "0 0 * * MON#2",
			base:  time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC),
			want:  time.Date(2024, time.January, 8, 0, 0, 0, 0, time.UTC),
		},
		{
			value: "0 0 * * L5",
			base:  time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC),
			want:  time.Date(2024, time.January, 26, 0, 0, 0, 0, time.UTC),
		},
		{
			value: "0 0 * * MON,MON#2",
			base:  time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC),
			want:  time.Date(2024, time.January, 8, 0, 0, 0, 0, time.UTC),
		},
		{
			value: "0 0 * * FRI,L5",
			base:  time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC),
			want:  time.Date(2024, time.January, 26, 0, 0, 0, 0, time.UTC),
		},
		{
			value: "0 0 29 2 *",
			base:  time.Date(2096, time.February, 29, 0, 0, 0, 0, time.UTC),
			want:  time.Date(2104, time.February, 29, 0, 0, 0, 0, time.UTC),
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.value, func(t *testing.T) {
			t.Parallel()
			schedule, err := parseCurrentCron(test.value)
			if err != nil {
				t.Fatal(err)
			}
			if got := schedule.Next(test.base); !got.Equal(test.want) {
				t.Fatalf("Next() = %s, want %s", got, test.want)
			}
		})
	}
}

func TestValidateTimezoneUsesIANAContract(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"UTC", "Europe/Kyiv", "Asia/Tokyo", "Etc/GMT-3"} {
		if err := ValidateTimezone(value); err != nil {
			t.Fatalf("timezone %q: %v", value, err)
		}
	}
	for _, value := range []string{"", "Local", "Mars/Olympus", "UTC\nInjected"} {
		if err := ValidateTimezone(value); !errors.Is(err, ErrInvalidTimezone) {
			t.Fatalf("timezone %q error = %v", value, err)
		}
	}
}

func TestServiceBuildsCurrentShapeAndKeepsActorAsAuditIdentity(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.July, 27, 9, 34, 56, 123456789, time.UTC)
	store := &scheduleStoreStub{result: MutationResult{
		IndexesMeta: map[string]any{"docs": map[string]any{}},
	}}
	service, err := newService(store, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	private := true
	credentials := &Credentials{Private: &private, EliteaTitle: "personal-github"}
	result, err := service.Update(context.Background(), Update{
		ProjectID: 7, ActorUserID: 11, ToolkitID: 19, IndexMetaID: "docs",
		Cron: " 0 3 * * * ", Enabled: true, RequestedUserID: -1,
		Credentials: credentials, Timezone: "Europe/Kyiv",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result, store.result) || store.calls != 1 {
		t.Fatalf("result=%#v calls=%d", result, store.calls)
	}
	mutation := store.mutation
	if mutation.ProjectID != 7 || mutation.ActorUserID != 11 ||
		mutation.ToolkitID != 19 || mutation.IndexMetaID != "docs" ||
		mutation.RequestedUserID != -1 || mutation.Schedule.Cron != "0 3 * * *" ||
		!mutation.Schedule.Enabled || mutation.Schedule.CreatedBy != 11 ||
		mutation.Schedule.Timezone != "Europe/Kyiv" ||
		mutation.Schedule.LastRun != "2026-07-27T09:34:56.123456+00:00" ||
		mutation.Schedule.Credentials == credentials ||
		!reflect.DeepEqual(mutation.Schedule.Credentials, credentials) {
		t.Fatalf("mutation=%#v", mutation)
	}

	_, err = service.Update(context.Background(), Update{
		ProjectID: 7, ActorUserID: 11, ToolkitID: 19, IndexMetaID: "docs",
		Cron: "0 3 * * *", RequestedUserID: 12, Timezone: "UTC",
	})
	if err != nil || store.calls != 2 ||
		store.mutation.RequestedUserID != 12 ||
		store.mutation.Schedule.CreatedBy != 11 {
		t.Fatalf("other-user error=%v calls=%d", err, store.calls)
	}
}

func TestServiceBoundsFieldsBeforeStorage(t *testing.T) {
	t.Parallel()
	store := &scheduleStoreStub{}
	service, err := NewService(store)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Update(context.Background(), Update{
		ProjectID: 1, ActorUserID: 2, ToolkitID: 3, IndexMetaID: "docs",
		Cron: "0 3 * * *", RequestedUserID: -1, Timezone: "UTC",
		Credentials: &Credentials{EliteaTitle: strings.Repeat("x", MaxCredentialTitleBytes+1)},
	})
	if !errors.Is(err, ErrInvalidRequest) || store.calls != 0 {
		t.Fatalf("error=%v calls=%d", err, store.calls)
	}
}

type scheduleStoreStub struct {
	mutation Mutation
	result   MutationResult
	err      error
	calls    int
}

func (store *scheduleStoreStub) Patch(
	_ context.Context,
	mutation Mutation,
) (MutationResult, error) {
	store.calls++
	store.mutation = mutation
	return store.result, store.err
}
