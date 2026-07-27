package indexing

import (
	"bytes"
	"context"
	"errors"
	"math"

	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

type CurrentManualStopCleanupRequest struct {
	ExecutionID string
	Generation  uint64
}

func (r CurrentManualStopCleanupRequest) Validate() error {
	if !validOptionalText(r.ExecutionID, maxIndexAdmissionStringBytes) ||
		r.ExecutionID == "" ||
		r.Generation == 0 ||
		r.Generation > math.MaxInt64 {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	return nil
}

type CurrentManualStopCleanupResolution string

const (
	CurrentManualStopCleanupApplied    CurrentManualStopCleanupResolution = "APPLIED"
	CurrentManualStopCleanupSuperseded CurrentManualStopCleanupResolution = "SUPERSEDED"
)

type CurrentManualStopCleanupClaim struct {
	CurrentManualStopCleanupRequest
	ClaimToken string
}

func (c CurrentManualStopCleanupClaim) Validate() error {
	if c.CurrentManualStopCleanupRequest.Validate() != nil ||
		!validOptionalText(c.ClaimToken, maxIndexAdmissionStringBytes) ||
		c.ClaimToken == "" {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	return nil
}

// CurrentManualStopCleanup is derived only from immutable admission evidence.
// It contains no worker-selected tenant, project, schema, or collection
// authority.
type CurrentManualStopCleanup struct {
	MetaID          string
	ExecutionID     string
	Generation      uint64
	IndexGeneration uint64
	IndexName       string
	ToolkitID       int32
}

func (c CurrentManualStopCleanup) Validate() error {
	if !validOptionalText(c.MetaID, executiondomain.MaxIndexMetaIDBytes) ||
		c.MetaID == "" ||
		!validOptionalText(c.ExecutionID, maxIndexAdmissionStringBytes) ||
		c.ExecutionID == "" ||
		c.Generation == 0 ||
		c.Generation > math.MaxInt64 ||
		c.IndexGeneration == 0 ||
		c.IndexGeneration > math.MaxInt64 ||
		c.IndexName == "" ||
		len(c.IndexName) > maxIndexAdmissionStringBytes ||
		c.ToolkitID <= 0 {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	return nil
}

type CurrentManualStopCleanupWriter interface {
	CleanupManualStop(context.Context, CurrentIndexMetaTarget, CurrentManualStopCleanup) error
}

// CurrentManualStopCleaner redeems the frozen toolkit snapshot only for the
// duration of the external write. Retry/backoff and claim ownership remain the
// reconciler's responsibility.
type CurrentManualStopCleaner struct {
	bindings CurrentIndexMetaTerminalBindingRepository
	toolkits FrozenToolkitConfigurationClaimer
	writer   CurrentManualStopCleanupWriter
}

func NewCurrentManualStopCleaner(
	bindings CurrentIndexMetaTerminalBindingRepository,
	toolkits FrozenToolkitConfigurationClaimer,
	writer CurrentManualStopCleanupWriter,
) (*CurrentManualStopCleaner, error) {
	if bindings == nil || toolkits == nil || writer == nil {
		return nil, errors.New("current manual Stop cleanup dependencies are required")
	}
	return &CurrentManualStopCleaner{
		bindings: bindings,
		toolkits: toolkits,
		writer:   writer,
	}, nil
}

func (c *CurrentManualStopCleaner) Cleanup(
	ctx context.Context,
	request CurrentManualStopCleanupRequest,
) error {
	if c == nil || c.bindings == nil || c.toolkits == nil ||
		c.writer == nil || ctx == nil {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	if err := request.Validate(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	binding, err := c.bindings.LoadCurrentIndexMetaTerminalBinding(
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
	claimed, err := c.toolkits.ClaimFrozenToolkitConfiguration(
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
	record := CurrentManualStopCleanup{
		MetaID:          binding.MetaID,
		ExecutionID:     binding.ExecutionID,
		Generation:      binding.Generation,
		IndexGeneration: binding.IndexGeneration,
		IndexName:       binding.IndexName,
		ToolkitID:       binding.ToolkitID,
	}
	if err := record.Validate(); err != nil {
		return err
	}
	if err := c.writer.CleanupManualStop(ctx, target, record); err != nil {
		return currentIndexMetaInitializationError(ctx, err)
	}
	return nil
}
