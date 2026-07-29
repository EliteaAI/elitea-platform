package indexmeta

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

func TestDeleteServicePreservesCurrentResolutionAndTwoCommitOrder(t *testing.T) {
	order := []string{}
	toolkits := &currentToolkitStub{
		found: true,
		toolkit: indexingapp.CurrentToolkitSnapshot{
			ID: 19, Type: "github", Settings: map[string]any{
				"pgvector_configuration": map[string]any{
					"elitea_title": "project-pgvector",
				},
				"github_configuration": map[string]any{
					"token": "must-not-expand",
				},
			},
		},
	}
	settings := &deleteSettingsStub{
		order: &order,
		result: map[string]any{
			"pgvector_configuration": map[string]any{
				"connection_string": "postgresql://secret-canary@project/vector",
			},
		},
	}
	external := &deleteExternalStub{order: &order, indexName: "Docs"}
	schedules := &deleteScheduleStub{order: &order}
	service := newDeleteServiceForTest(
		t,
		toolkits,
		settings,
		external,
		schedules,
	)
	request := DeleteRequest{
		ProjectID: 7, ActorUserID: 11, ToolkitID: 19,
		IndexMetaID: "meta-1",
	}
	if err := service.Delete(context.Background(), request); err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(order, []string{"settings", "pgvector", "schedule"}) {
		t.Fatalf("order=%v", order)
	}
	if toolkits.projectID != 7 || toolkits.userID != 11 ||
		toolkits.toolkitID != 19 {
		t.Fatalf(
			"toolkit lookup project=%d user=%d toolkit=%d",
			toolkits.projectID,
			toolkits.userID,
			toolkits.toolkitID,
		)
	}
	if settings.request.ProjectID != 7 || settings.request.UserID != 11 ||
		settings.request.ToolkitType != "github" ||
		settings.request.Mode != configurationapp.CurrentToolkitSettingsClaimMode ||
		len(settings.request.Settings) != 1 ||
		settings.request.Settings["pgvector_configuration"] == nil {
		t.Fatalf("settings request=%+v", settings.request)
	}
	if external.target.ConnectionString !=
		"postgresql://secret-canary@project/vector" ||
		external.target.SchemaID != 19 || external.indexMetaID != "meta-1" {
		t.Fatalf(
			"external target=%+v meta=%q",
			external.target,
			external.indexMetaID,
		)
	}
	if schedules.projectID != 7 || schedules.toolkitID != 19 ||
		schedules.indexName != "Docs" {
		t.Fatalf(
			"schedule project=%d toolkit=%d index=%q",
			schedules.projectID,
			schedules.toolkitID,
			schedules.indexName,
		)
	}
}

func TestDeleteServiceDoesNotCleanScheduleBeforePgvectorCommit(t *testing.T) {
	external := &deleteExternalStub{err: errors.New("pgvector failed")}
	schedules := &deleteScheduleStub{}
	service := validDeleteServiceForTest(t, external, schedules)
	err := service.Delete(context.Background(), DeleteRequest{
		ProjectID: 7, ActorUserID: 11, ToolkitID: 19,
		IndexMetaID: "meta-1",
	})
	if !errors.Is(err, ErrCurrentIndexMetaUnavailable) ||
		schedules.calls != 0 {
		t.Fatalf("error=%v schedule calls=%d", err, schedules.calls)
	}
}

func TestDeleteServicePreservesCurrentMissingMetadataAndCleanupToolkit(t *testing.T) {
	t.Run("metadata missing", func(t *testing.T) {
		schedules := &deleteScheduleStub{}
		service := validDeleteServiceForTest(
			t,
			&deleteExternalStub{err: ErrCurrentIndexMetaNotFound},
			schedules,
		)
		err := service.Delete(context.Background(), DeleteRequest{
			ProjectID: 7, ActorUserID: 11, ToolkitID: 19,
			IndexMetaID: "meta-1",
		})
		if !errors.Is(err, ErrCurrentIndexMetaNotFound) ||
			schedules.calls != 0 {
			t.Fatalf("error=%v schedule calls=%d", err, schedules.calls)
		}
	})

	t.Run("toolkit disappears after pgvector commit", func(t *testing.T) {
		service := validDeleteServiceForTest(
			t,
			&deleteExternalStub{indexName: "Docs"},
			&deleteScheduleStub{err: ErrCurrentIndexScheduleToolkitMissing},
		)
		err := service.Delete(context.Background(), DeleteRequest{
			ProjectID: 7, ActorUserID: 11, ToolkitID: 19,
			IndexMetaID: "meta-1",
		})
		var missing *ScheduleToolkitMissingError
		if !errors.As(err, &missing) || missing.ProjectID != 7 ||
			missing.ToolkitID != 19 || missing.IndexName != "Docs" {
			t.Fatalf("error=%v typed=%+v", err, missing)
		}
	})

	t.Run("schedule cleanup fails after pgvector commit", func(t *testing.T) {
		const rawDatabaseError = "password=secret-canary schedule update failed"
		service := validDeleteServiceForTest(
			t,
			&deleteExternalStub{indexName: "Docs"},
			&deleteScheduleStub{err: errors.New(rawDatabaseError)},
		)
		err := service.Delete(context.Background(), DeleteRequest{
			ProjectID: 7, ActorUserID: 11, ToolkitID: 19,
			IndexMetaID: "meta-1",
		})
		var cleanup *ScheduleCleanupError
		if !errors.As(err, &cleanup) || cleanup.ProjectID != 7 ||
			cleanup.ToolkitID != 19 || cleanup.IndexName != "Docs" {
			t.Fatalf("error=%v typed=%+v", err, cleanup)
		}
		if strings.Contains(err.Error(), rawDatabaseError) ||
			strings.Contains(err.Error(), "secret-canary") {
			t.Fatalf("cleanup error leaked raw database exception: %v", err)
		}
	})
}

func TestDeleteServicePreservesCurrentTargetValidation(t *testing.T) {
	for name, test := range map[string]struct {
		toolkits indexingapp.CurrentToolkitReader
		settings indexingapp.CurrentToolkitSettingsValidator
		want     error
	}{
		"toolkit missing": {
			toolkits: &currentToolkitStub{},
			settings: &currentSettingsStub{},
			want:     ErrCurrentIndexMetaToolkitMissing,
		},
		"pgvector reference missing": {
			toolkits: &currentToolkitStub{
				found: true,
				toolkit: indexingapp.CurrentToolkitSnapshot{
					ID: 19, Type: "github", Settings: map[string]any{},
				},
			},
			settings: &currentSettingsStub{},
			want:     ErrCurrentIndexMetaTargetMissing,
		},
		"empty saved pgvector configuration is missing": {
			toolkits: &currentToolkitStub{
				found: true,
				toolkit: indexingapp.CurrentToolkitSnapshot{
					ID: 19, Type: "github", Settings: map[string]any{
						"pgvector_configuration": map[string]any{},
					},
				},
			},
			settings: &deleteSettingsStub{},
			want:     ErrCurrentIndexMetaTargetMissing,
		},
		"expanded pgvector missing": {
			toolkits: &currentToolkitStub{
				found: true,
				toolkit: indexingapp.CurrentToolkitSnapshot{
					ID: 19, Type: "github", Settings: map[string]any{
						"pgvector_configuration": map[string]any{
							"elitea_title": "project-pgvector",
						},
					},
				},
			},
			settings: &currentSettingsStub{result: map[string]any{}},
			want:     ErrCurrentIndexMetaTargetMissing,
		},
		"expanded pgvector empty object is missing": {
			toolkits: &currentToolkitStub{
				found: true,
				toolkit: indexingapp.CurrentToolkitSnapshot{
					ID: 19, Type: "github", Settings: map[string]any{
						"pgvector_configuration": map[string]any{
							"elitea_title": "project-pgvector",
						},
					},
				},
			},
			settings: &currentSettingsStub{result: map[string]any{
				"pgvector_configuration": map[string]any{},
			}},
			want: ErrCurrentIndexMetaTargetMissing,
		},
		"connection string missing from nonempty configuration": {
			toolkits: &currentToolkitStub{
				found: true,
				toolkit: indexingapp.CurrentToolkitSnapshot{
					ID: 19, Type: "github", Settings: map[string]any{
						"pgvector_configuration": map[string]any{
							"elitea_title": "project-pgvector",
						},
					},
				},
			},
			settings: &currentSettingsStub{result: map[string]any{
				"pgvector_configuration": map[string]any{
					"elitea_title": "project-pgvector",
				},
			}},
			want: ErrCurrentIndexMetaConnectionMissing,
		},
	} {
		t.Run(name, func(t *testing.T) {
			service := newDeleteServiceForTest(
				t,
				test.toolkits,
				test.settings,
				&deleteExternalStub{},
				&deleteScheduleStub{},
			)
			err := service.Delete(context.Background(), DeleteRequest{
				ProjectID: 7, ActorUserID: 11, ToolkitID: 19,
				IndexMetaID: "meta-1",
			})
			if !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
		})
	}
}

func validDeleteServiceForTest(
	t *testing.T,
	external ExternalDeleter,
	schedules ScheduleCleaner,
) *DeleteService {
	t.Helper()
	return newDeleteServiceForTest(
		t,
		&currentToolkitStub{
			found: true,
			toolkit: indexingapp.CurrentToolkitSnapshot{
				ID: 19, Type: "github", Settings: map[string]any{
					"pgvector_configuration": map[string]any{
						"elitea_title": "project-pgvector",
					},
				},
			},
		},
		&currentSettingsStub{result: map[string]any{
			"pgvector_configuration": map[string]any{
				"connection_string": "postgresql://project/vector",
			},
		}},
		external,
		schedules,
	)
}

func newDeleteServiceForTest(
	t *testing.T,
	toolkits indexingapp.CurrentToolkitReader,
	settings indexingapp.CurrentToolkitSettingsValidator,
	external ExternalDeleter,
	schedules ScheduleCleaner,
) *DeleteService {
	t.Helper()
	service, err := NewDeleteService(
		toolkits,
		settings,
		external,
		schedules,
	)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

type deleteSettingsStub struct {
	order   *[]string
	request configurationapp.CurrentToolkitSettingsRequest
	result  map[string]any
	err     error
}

func (s *deleteSettingsStub) Resolve(
	_ context.Context,
	request configurationapp.CurrentToolkitSettingsRequest,
) (map[string]any, error) {
	if s.order != nil {
		*s.order = append(*s.order, "settings")
	}
	s.request = request
	return s.result, s.err
}

type deleteExternalStub struct {
	order       *[]string
	target      ResolvedTarget
	indexMetaID string
	indexName   string
	err         error
}

func (s *deleteExternalStub) Delete(
	_ context.Context,
	target ResolvedTarget,
	indexMetaID string,
) (string, error) {
	if s.order != nil {
		*s.order = append(*s.order, "pgvector")
	}
	s.target = target
	s.indexMetaID = indexMetaID
	return s.indexName, s.err
}

type deleteScheduleStub struct {
	order                       *[]string
	projectID, toolkitID, calls int32
	indexName                   string
	err                         error
}

func (s *deleteScheduleStub) DeleteCurrentIndexSchedule(
	_ context.Context,
	projectID, toolkitID int32,
	indexName string,
) error {
	if s.order != nil {
		*s.order = append(*s.order, "schedule")
	}
	s.calls++
	s.projectID = projectID
	s.toolkitID = toolkitID
	s.indexName = indexName
	return s.err
}
