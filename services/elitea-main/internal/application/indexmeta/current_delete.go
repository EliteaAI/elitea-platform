package indexmeta

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

const MaxCurrentIndexMetaCollectionBytes = 4 << 10

var (
	ErrCurrentIndexMetaNotFound           = errors.New("current index metadata was not found")
	ErrCurrentIndexMetaConnectionMissing  = errors.New("current index metadata connection string is unavailable")
	ErrCurrentIndexScheduleToolkitMissing = errors.New("current index metadata schedule toolkit was not found")
	ErrCurrentIndexScheduleUnavailable    = errors.New("current index metadata schedule cleanup failed")
)

// DeleteRequest contains identities from the already-authenticated and
// project-authorized current REST request. The caller cannot provide a schema
// or PgVector connection string.
type DeleteRequest struct {
	ProjectID   int64
	ActorUserID int64
	ToolkitID   int64
	IndexMetaID string
}

func (r DeleteRequest) validate() error {
	if r.ProjectID <= 0 || r.ProjectID > math.MaxInt32 ||
		r.ActorUserID <= 0 || r.ActorUserID > math.MaxInt32 ||
		r.ToolkitID <= 0 || r.ToolkitID > math.MaxInt32 ||
		!validCurrentIndexMetaDeleteText(r.IndexMetaID, MaxCurrentIndexMetaIDBytes) {
		return ErrInvalidCurrentIndexMetaRequest
	}
	return nil
}

// ExternalDeleter performs the current PgVector transaction: select one
// metadata row, derive its collection, delete that collection, then commit.
type ExternalDeleter interface {
	Delete(context.Context, ResolvedTarget, string) (indexName string, err error)
}

// ScheduleCleaner owns the second, project-tenant transaction. It removes the
// complete indexes_meta[indexName] entry, including every user's schedule.
type ScheduleCleaner interface {
	DeleteCurrentIndexSchedule(
		context.Context,
		int32,
		int32,
		string,
	) error
}

// ScheduleToolkitMissingError preserves the current cleanup-race response
// without exposing an internal database error.
type ScheduleToolkitMissingError struct {
	ProjectID int32
	ToolkitID int32
	IndexName string
}

func (e *ScheduleToolkitMissingError) Error() string {
	if e == nil {
		return ErrCurrentIndexScheduleToolkitMissing.Error()
	}
	return fmt.Sprintf(
		"Toolkit %d not found (project_id=%d, index_name='%s')",
		e.ToolkitID,
		e.ProjectID,
		e.IndexName,
	)
}

func (e *ScheduleToolkitMissingError) Unwrap() error {
	return ErrCurrentIndexScheduleToolkitMissing
}

// ScheduleCleanupError retains the current response context after PgVector has
// committed while keeping the underlying database error private.
type ScheduleCleanupError struct {
	ProjectID int32
	ToolkitID int32
	IndexName string
}

func (e *ScheduleCleanupError) Error() string {
	if e == nil {
		return ErrCurrentIndexScheduleUnavailable.Error()
	}
	return fmt.Sprintf(
		"Error during index deletion (Toolkit %dproject_id=%d, index_name='%s') %s",
		e.ToolkitID,
		e.ProjectID,
		e.IndexName,
		ErrCurrentIndexScheduleUnavailable,
	)
}

func (e *ScheduleCleanupError) Unwrap() error {
	return ErrCurrentIndexScheduleUnavailable
}

// DeleteService is deliberately synchronous. It preserves the current two
// independent commits: PgVector first, project-tenant schedule cleanup second.
// A failure of the second transaction does not roll back the first one.
type DeleteService struct {
	toolkits  indexingapp.CurrentToolkitReader
	settings  indexingapp.CurrentToolkitSettingsValidator
	external  ExternalDeleter
	schedules ScheduleCleaner
}

func NewDeleteService(
	toolkits indexingapp.CurrentToolkitReader,
	settings indexingapp.CurrentToolkitSettingsValidator,
	external ExternalDeleter,
	schedules ScheduleCleaner,
) (*DeleteService, error) {
	if toolkits == nil || settings == nil || external == nil || schedules == nil {
		return nil, errors.New("current index metadata delete dependencies are required")
	}
	return &DeleteService{
		toolkits:  toolkits,
		settings:  settings,
		external:  external,
		schedules: schedules,
	}, nil
}

func (s *DeleteService) Delete(ctx context.Context, request DeleteRequest) error {
	if s == nil || s.toolkits == nil || s.settings == nil ||
		s.external == nil || s.schedules == nil || ctx == nil {
		return ErrInvalidCurrentIndexMetaRequest
	}
	if err := request.validate(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	projectID := int32(request.ProjectID)
	actorUserID := int32(request.ActorUserID)
	toolkitID := int32(request.ToolkitID)
	target, err := s.resolveTarget(ctx, projectID, actorUserID, toolkitID)
	if err != nil {
		return err
	}
	indexName, err := s.external.Delete(ctx, target, request.IndexMetaID)
	if err != nil {
		if errors.Is(err, ErrCurrentIndexMetaNotFound) {
			return ErrCurrentIndexMetaNotFound
		}
		return currentIndexMetaDependencyError(
			ctx,
			ErrCurrentIndexMetaUnavailable,
			err,
		)
	}
	if !validCurrentIndexMetaDeleteText(
		indexName,
		MaxCurrentIndexMetaCollectionBytes,
	) {
		return ErrCurrentIndexMetaUnavailable
	}
	if err := s.schedules.DeleteCurrentIndexSchedule(
		ctx,
		projectID,
		toolkitID,
		indexName,
	); err != nil {
		if errors.Is(err, ErrCurrentIndexScheduleToolkitMissing) {
			return &ScheduleToolkitMissingError{
				ProjectID: projectID,
				ToolkitID: toolkitID,
				IndexName: indexName,
			}
		}
		safe := currentIndexMetaDependencyError(
			ctx,
			ErrCurrentIndexScheduleUnavailable,
			err,
		)
		if !errors.Is(safe, ErrCurrentIndexScheduleUnavailable) {
			return safe
		}
		return &ScheduleCleanupError{
			ProjectID: projectID,
			ToolkitID: toolkitID,
			IndexName: indexName,
		}
	}
	return nil
}

func (s *DeleteService) resolveTarget(
	ctx context.Context,
	projectID, actorUserID, toolkitID int32,
) (ResolvedTarget, error) {
	toolkit, found, err := s.toolkits.GetCurrentToolkit(
		ctx,
		projectID,
		actorUserID,
		toolkitID,
	)
	if err != nil {
		return ResolvedTarget{}, currentIndexMetaDependencyError(
			ctx,
			ErrCurrentIndexMetaUnavailable,
			err,
		)
	}
	if !found {
		return ResolvedTarget{}, ErrCurrentIndexMetaToolkitMissing
	}
	if toolkit.ID != toolkitID || toolkit.ID <= 0 || toolkit.Type == "" ||
		len(toolkit.Type) > configurationapp.MaxCurrentToolkitSettingsIdentifier ||
		strings.ContainsAny(toolkit.Type, "\x00\r\n") || toolkit.Settings == nil {
		return ResolvedTarget{}, ErrCurrentIndexMetaTargetMissing
	}

	pgvectorReference, present := toolkit.Settings["pgvector_configuration"]
	if !present || pgvectorReference == nil {
		return ResolvedTarget{}, ErrCurrentIndexMetaTargetMissing
	}
	expanded, err := s.settings.Resolve(
		ctx,
		configurationapp.CurrentToolkitSettingsRequest{
			ToolkitType: toolkit.Type,
			Settings: map[string]any{
				"pgvector_configuration": pgvectorReference,
			},
			ProjectID: projectID,
			UserID:    actorUserID,
			Mode:      configurationapp.CurrentToolkitSettingsClaimMode,
		},
	)
	if err != nil {
		return ResolvedTarget{}, currentIndexMetaDependencyError(
			ctx,
			ErrCurrentIndexMetaTargetMissing,
			err,
		)
	}
	if value, present := expanded["pgvector_configuration"]; !present ||
		value == nil {
		return ResolvedTarget{}, ErrCurrentIndexMetaTargetMissing
	}
	connectionString, ok := currentPgvectorConnectionString(expanded)
	if !ok {
		return ResolvedTarget{}, ErrCurrentIndexMetaConnectionMissing
	}
	return ResolvedTarget{
		ConnectionString: connectionString,
		SchemaID:         toolkit.ID,
	}, nil
}

func validCurrentIndexMetaDeleteText(value string, limit int) bool {
	return value != "" && len(value) <= limit && utf8.ValidString(value) &&
		!strings.ContainsAny(value, "\x00\r\n")
}

var _ interface {
	Delete(context.Context, DeleteRequest) error
} = (*DeleteService)(nil)
