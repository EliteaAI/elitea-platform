package repos

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	indexscheduleapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexschedule"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestCurrentIndexSchedulePatchRepositoryLocksAndMutatesOnlyTargetSchedule(t *testing.T) {
	t.Parallel()

	executor := &scriptedExecutor{
		rowResults: []scriptedRow{{values: []any{
			[]byte(`{"pgvector_configuration":{"private":true},"untouched":17}`),
			[]byte(`{"root":"keep","large_id":9007199254740993,"indexes_meta":{"docs":{"title":"Docs","schedules":{"5":{"enabled":false}}},"wiki":{"marker":"keep"}}}`),
		}}},
		execTags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 1")},
	}
	projects := &currentScheduleProjectStore{scriptedExecutor: executor}
	repository, err := newCurrentIndexSchedulePatchRepository(projects)
	if err != nil {
		t.Fatal(err)
	}

	result, err := repository.Patch(context.Background(), indexscheduleapp.Mutation{
		ProjectID: 7, ActorUserID: 11, ToolkitID: 19, IndexMetaID: "docs",
		RequestedUserID: -1,
		Schedule: indexscheduleapp.Schedule{
			Cron: "0 3 * * *", Enabled: true,
			Credentials: &indexscheduleapp.Credentials{
				Private: boolPointer(true), EliteaTitle: "personal-github",
			},
			CreatedBy: 11, Timezone: "Europe/Kyiv",
			LastRun: "2026-07-27T09:34:56.123456+00:00",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if projects.projectID != 7 ||
		projects.options.IsoLevel != pgx.ReadCommitted ||
		projects.options.AccessMode != pgx.ReadWrite {
		t.Fatalf("project=%d options=%+v", projects.projectID, projects.options)
	}
	if result.EffectiveUserID != 11 {
		t.Fatalf("effective user=%d", result.EffectiveUserID)
	}
	if len(executor.rowCalls) != 1 ||
		!strings.Contains(executor.rowCalls[0].sql, "FOR UPDATE") ||
		!reflect.DeepEqual(executor.rowCalls[0].args, []any{int32(19)}) {
		t.Fatalf("lock query=%+v", executor.rowCalls)
	}
	if len(executor.execCalls) != 1 ||
		!reflect.DeepEqual(executor.execCalls[0].args[1:], []any{int32(19)}) {
		t.Fatalf("update=%+v", executor.execCalls)
	}

	persisted, err := decodeCurrentScheduleObject(executor.execCalls[0].args[0].([]byte))
	if err != nil {
		t.Fatal(err)
	}
	if persisted["root"] != "keep" {
		t.Fatalf("unrelated metadata was changed: %#v", persisted)
	}
	if persisted["large_id"] != json.Number("9007199254740993") {
		t.Fatalf("metadata number was rounded: %#v", persisted["large_id"])
	}
	indexes := persisted["indexes_meta"].(map[string]any)
	if !reflect.DeepEqual(indexes["wiki"], map[string]any{"marker": "keep"}) {
		t.Fatalf("unrelated index was changed: %#v", indexes["wiki"])
	}
	docs := indexes["docs"].(map[string]any)
	if docs["title"] != "Docs" {
		t.Fatalf("target index fields were changed: %#v", docs)
	}
	schedules := docs["schedules"].(map[string]any)
	if _, present := schedules["5"]; !present {
		t.Fatalf("existing schedule was removed: %#v", schedules)
	}
	added := schedules["11"].(map[string]any)
	if added["cron"] != "0 3 * * *" ||
		added["enabled"] != true ||
		added["created_by"] != json.Number("11") ||
		added["timezone"] != "Europe/Kyiv" {
		t.Fatalf("added schedule=%#v", added)
	}
	if !reflect.DeepEqual(result.IndexesMeta, indexes) {
		t.Fatalf("raw indexes_meta result=%#v persisted=%#v", result.IndexesMeta, indexes)
	}
}

func TestCurrentIndexSchedulePatchRepositoryPreservesTeamAndCredentialRules(t *testing.T) {
	t.Parallel()

	schedule := indexscheduleapp.Schedule{
		Cron: "0 3 * * *", CreatedBy: 11, Timezone: "UTC",
		LastRun: "2026-07-27T09:34:56+00:00",
	}
	for _, test := range []struct {
		name        string
		privateTool bool
		credentials *indexscheduleapp.Credentials
		wantUser    int64
		wantError   error
		wantUpdate  bool
	}{
		{
			name: "public toolkit keeps project schedule",
			credentials: &indexscheduleapp.Credentials{
				Private: boolPointer(false), EliteaTitle: "shared-github",
			},
			wantUser:   -1,
			wantUpdate: true,
		},
		{
			name:        "private toolkit maps project sentinel to actor",
			privateTool: true,
			credentials: &indexscheduleapp.Credentials{
				Private: boolPointer(true), EliteaTitle: "personal-github",
			},
			wantUser:   11,
			wantUpdate: true,
		},
		{
			name: "public toolkit rejects private team credential",
			credentials: &indexscheduleapp.Credentials{
				Private: boolPointer(true), EliteaTitle: "personal-github",
			},
			wantError: indexscheduleapp.ErrPrivateTeamCredentials,
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			settings, err := json.Marshal(map[string]any{
				"pgvector_configuration": map[string]any{"private": test.privateTool},
			})
			if err != nil {
				t.Fatal(err)
			}
			executor := &scriptedExecutor{
				rowResults: []scriptedRow{{values: []any{
					settings,
					[]byte(`{"indexes_meta":{"docs":{"schedules":{}}}}`),
				}}},
				execTags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 1")},
			}
			repository, err := newCurrentIndexSchedulePatchRepository(
				&currentScheduleProjectStore{scriptedExecutor: executor},
			)
			if err != nil {
				t.Fatal(err)
			}
			mutationSchedule := schedule
			mutationSchedule.Credentials = test.credentials
			result, err := repository.Patch(context.Background(), indexscheduleapp.Mutation{
				ProjectID: 7, ActorUserID: 11, ToolkitID: 19, IndexMetaID: "docs",
				RequestedUserID: -1, Schedule: mutationSchedule,
			})
			if !errors.Is(err, test.wantError) {
				t.Fatalf("error=%v want=%v", err, test.wantError)
			}
			if len(executor.execCalls) != boolInt(test.wantUpdate) {
				t.Fatalf("updates=%d want=%t", len(executor.execCalls), test.wantUpdate)
			}
			if test.wantUpdate && result.EffectiveUserID != test.wantUser {
				t.Fatalf("effective user=%d want=%d", result.EffectiveUserID, test.wantUser)
			}
		})
	}
}

func TestCurrentIndexSchedulePatchRepositoryBoundsAndRedactsFailures(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name     string
		row      scriptedRow
		want     error
		mutation indexscheduleapp.Mutation
	}{
		{
			name: "missing toolkit",
			row:  scriptedRow{err: pgx.ErrNoRows},
			want: indexscheduleapp.ErrToolkitNotFound,
		},
		{
			name: "invalid settings",
			row: scriptedRow{values: []any{
				[]byte(`{"pgvector_configuration":{"private":"yes"}}`),
				[]byte(`{"indexes_meta":{}}`),
			}},
			want: indexscheduleapp.ErrInvalidToolkit,
		},
		{
			name: "null indexes meta preserves current failure",
			row: scriptedRow{values: []any{
				[]byte(`{"pgvector_configuration":{"private":false}}`),
				[]byte(`{"indexes_meta":null}`),
			}},
			want: indexscheduleapp.ErrInvalidToolkit,
		},
		{
			name: "database detail is redacted",
			row:  scriptedRow{err: errors.New("password=should-not-leak")},
			want: indexscheduleapp.ErrScheduleUnavailable,
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			executor := &scriptedExecutor{rowResults: []scriptedRow{test.row}}
			repository, err := newCurrentIndexSchedulePatchRepository(
				&currentScheduleProjectStore{scriptedExecutor: executor},
			)
			if err != nil {
				t.Fatal(err)
			}
			_, err = repository.Patch(context.Background(), indexscheduleapp.Mutation{
				ProjectID: 7, ActorUserID: 11, ToolkitID: 19, IndexMetaID: "docs",
				RequestedUserID: -1,
				Schedule: indexscheduleapp.Schedule{
					Cron: "0 3 * * *", CreatedBy: 11, Timezone: "UTC",
					LastRun: "2026-07-27T09:34:56+00:00",
				},
			})
			if !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
			if strings.Contains(err.Error(), "password") {
				t.Fatalf("unsafe error=%v", err)
			}
		})
	}
}

type currentScheduleProjectStore struct {
	projectID int64
	options   pgx.TxOptions
	*scriptedExecutor
}

func (store *currentScheduleProjectStore) WithinProjectTx(
	ctx context.Context,
	projectID int64,
	options pgx.TxOptions,
	fn func(sqlExecutor) error,
) error {
	store.projectID = projectID
	store.options = options
	return fn(store.scriptedExecutor)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func boolPointer(value bool) *bool {
	return &value
}
