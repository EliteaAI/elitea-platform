package indexing

import (
	"bytes"
	"context"
	"errors"
	"math"
	"time"

	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

const MaxCurrentIndexMetaTaskRestampSourceEventIDBytes = 512

type CurrentIndexMetaTaskRestampRequest struct {
	ExecutionID   string
	Generation    uint64
	SourceEventID string
	OccurredAt    time.Time
	CreatedOn     float64
}

func (r CurrentIndexMetaTaskRestampRequest) Validate() error {
	if !validOptionalText(r.ExecutionID, maxIndexAdmissionStringBytes) ||
		r.ExecutionID == "" ||
		r.Generation == 0 || r.Generation > math.MaxInt64 ||
		!validOptionalText(
			r.SourceEventID,
			MaxCurrentIndexMetaTaskRestampSourceEventIDBytes,
		) ||
		r.SourceEventID == "" ||
		r.OccurredAt.IsZero() ||
		math.IsNaN(r.CreatedOn) || math.IsInf(r.CreatedOn, 0) ||
		r.CreatedOn <= 0 {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	return nil
}

type CurrentIndexMetaTaskRestampClaim struct {
	CurrentIndexMetaTaskRestampRequest
	ClaimToken string
}

func (c CurrentIndexMetaTaskRestampClaim) Validate() error {
	if err := c.CurrentIndexMetaTaskRestampRequest.Validate(); err != nil ||
		!validOptionalText(c.ClaimToken, maxIndexAdmissionStringBytes) ||
		c.ClaimToken == "" {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	return nil
}

type CurrentIndexMetaTaskRestampResolution string

const (
	CurrentIndexMetaTaskRestampApplied    CurrentIndexMetaTaskRestampResolution = "APPLIED"
	CurrentIndexMetaTaskRestampSuperseded CurrentIndexMetaTaskRestampResolution = "SUPERSEDED"
)

// CurrentTaskRestampIndexMeta is built exclusively from the immutable
// PostgreSQL admission plus the source event's created_on generation marker.
// TaskID is ExecutionID; no identity from browser JSON reaches the writer.
type CurrentTaskRestampIndexMeta struct {
	MetaID          string
	ExecutionID     string
	Generation      uint64
	IndexGeneration uint64
	IndexName       string
	ToolkitID       int32
	CreatedOn       float64
}

func (m CurrentTaskRestampIndexMeta) Validate() error {
	if !validOptionalText(m.MetaID, executiondomain.MaxIndexMetaIDBytes) || m.MetaID == "" ||
		!validOptionalText(m.ExecutionID, maxIndexAdmissionStringBytes) ||
		m.ExecutionID == "" ||
		m.Generation == 0 || m.Generation > math.MaxInt64 ||
		m.IndexGeneration == 0 || m.IndexGeneration > math.MaxInt64 ||
		m.IndexName == "" || len(m.IndexName) > maxIndexAdmissionStringBytes ||
		m.ToolkitID <= 0 ||
		math.IsNaN(m.CreatedOn) || math.IsInf(m.CreatedOn, 0) ||
		m.CreatedOn <= 0 {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	return nil
}

// Keep the existing immutable binding shape; it already contains precisely the
// admission-owned project, actor, toolkit, index, generation and frozen config.
type CurrentIndexMetaTaskRestampBinding = CurrentIndexMetaTerminalBinding

type CurrentIndexMetaTaskRestampBindingRepository interface {
	LoadCurrentIndexMetaTaskRestampBinding(
		context.Context,
		string,
		uint64,
	) (CurrentIndexMetaTaskRestampBinding, error)
}

type CurrentIndexMetaTaskRestampWriter interface {
	MaterializeTaskID(
		context.Context,
		CurrentIndexMetaTarget,
		CurrentTaskRestampIndexMeta,
	) error
}

type CurrentIndexMetaTaskRestamper struct {
	bindings CurrentIndexMetaTaskRestampBindingRepository
	toolkits FrozenToolkitConfigurationClaimer
	writer   CurrentIndexMetaTaskRestampWriter
}

func NewCurrentIndexMetaTaskRestamper(
	bindings CurrentIndexMetaTaskRestampBindingRepository,
	toolkits FrozenToolkitConfigurationClaimer,
	writer CurrentIndexMetaTaskRestampWriter,
) (*CurrentIndexMetaTaskRestamper, error) {
	if bindings == nil || toolkits == nil || writer == nil {
		return nil, errors.New("current index metadata task restamper dependencies are required")
	}
	return &CurrentIndexMetaTaskRestamper{
		bindings: bindings,
		toolkits: toolkits,
		writer:   writer,
	}, nil
}

func (r *CurrentIndexMetaTaskRestamper) Restamp(
	ctx context.Context,
	request CurrentIndexMetaTaskRestampRequest,
) error {
	if r == nil || r.bindings == nil || r.toolkits == nil ||
		r.writer == nil || ctx == nil {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	if err := request.Validate(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	binding, err := r.bindings.LoadCurrentIndexMetaTaskRestampBinding(
		ctx,
		request.ExecutionID,
		request.Generation,
	)
	if err != nil {
		return currentIndexMetaInitializationError(ctx, err)
	}
	if err := binding.Validate(); err != nil ||
		binding.ExecutionID != request.ExecutionID ||
		binding.Generation != request.Generation {
		return ErrCurrentIndexMetaConflict
	}
	claimed, err := r.toolkits.ClaimFrozenToolkitConfiguration(
		ctx,
		FrozenToolkitConfigurationClaim{
			ResourceProjectID:    binding.ResourceProjectID,
			ActorUserID:          binding.ActorUserID,
			ToolkitConfiguration: bytes.Clone(binding.ToolkitConfiguration),
		},
	)
	if err != nil {
		return currentIndexMetaInitializationError(ctx, err)
	}
	target, err := currentIndexMetaTarget(
		claimed,
		binding.ToolkitID,
		binding.ResourceProjectID,
	)
	if err != nil {
		return err
	}
	record := CurrentTaskRestampIndexMeta{
		MetaID:          binding.MetaID,
		ExecutionID:     binding.ExecutionID,
		Generation:      binding.Generation,
		IndexGeneration: binding.IndexGeneration,
		IndexName:       binding.IndexName,
		ToolkitID:       binding.ToolkitID,
		CreatedOn:       request.CreatedOn,
	}
	if err := record.Validate(); err != nil {
		return err
	}
	if err := r.writer.MaterializeTaskID(ctx, target, record); err != nil {
		return currentIndexMetaInitializationError(ctx, err)
	}
	return nil
}
