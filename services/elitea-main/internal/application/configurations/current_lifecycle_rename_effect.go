package configurations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

const (
	MaxCurrentConfigurationRenameToolkits      = 10_000
	MaxCurrentConfigurationRenameSettingsBytes = 4 << 20
	MaxCurrentConfigurationRenameTotalBytes    = 32 << 20
	MaxCurrentConfigurationRenameDepth         = 32
	MaxCurrentConfigurationRenameNodes         = 16_384
	MaxCurrentConfigurationRenameCASAttempts   = 4
	MaxCurrentConfigurationRenameIdentityBytes = 1_024
)

type CurrentConfigurationRenameScanLimits struct {
	MaxRows          int
	MaxSettingsBytes int
	MaxTotalBytes    int
}

// CurrentConfigurationRenameToolkit is one owned JSON settings snapshot.
// Version is an opaque repository-generated compare-and-swap token.
type CurrentConfigurationRenameToolkit struct {
	ToolkitID int32
	Version   string
	Settings  json.RawMessage
}

type CurrentConfigurationRenameToolkitUpdate struct {
	ProjectID       int32
	ToolkitID       int32
	ExpectedVersion string
	Settings        json.RawMessage
}

// CurrentConfigurationRenameRepository provides a deterministic bounded scan
// and optimistic writes. List must return every elitea_tools row in the project
// when the result fits Limits. CompareAndSwap must update only the row matching
// ExpectedVersion; it returns false for a concurrent change or deleted row.
type CurrentConfigurationRenameRepository interface {
	ListCurrentConfigurationRenameToolkits(
		context.Context,
		int32,
		CurrentConfigurationRenameScanLimits,
	) ([]CurrentConfigurationRenameToolkit, error)
	GetCurrentConfigurationRenameToolkit(
		context.Context,
		int32,
		int32,
	) (CurrentConfigurationRenameToolkit, bool, error)
	CompareAndSwapCurrentConfigurationRenameToolkit(
		context.Context,
		CurrentConfigurationRenameToolkitUpdate,
	) (bool, error)
}

// CurrentConfigurationRenameReferenceEffect repairs saved toolkit configuration
// references after an elitea_title change. It is safe to retry: already-renamed
// documents are no-ops, while concurrent settings changes are reloaded before a
// bounded compare-and-swap retry.
type CurrentConfigurationRenameReferenceEffect struct {
	repository CurrentConfigurationRenameRepository
}

func NewCurrentConfigurationRenameReferenceEffect(
	repository CurrentConfigurationRenameRepository,
) (*CurrentConfigurationRenameReferenceEffect, error) {
	if repository == nil {
		return nil, ErrInvalidCurrentConfigurationLifecycleInternalEffect
	}
	return &CurrentConfigurationRenameReferenceEffect{repository: repository}, nil
}

func (e *CurrentConfigurationRenameReferenceEffect) RenameCurrentConfigurationReferences(
	ctx context.Context,
	effect CurrentConfigurationRenameEffect,
) error {
	if !validCurrentConfigurationRenameEffect(ctx, e, effect) {
		return ErrInvalidCurrentConfigurationLifecycleInternalEffect
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	toolkits, err := e.repository.ListCurrentConfigurationRenameToolkits(
		ctx,
		effect.ProjectID,
		CurrentConfigurationRenameScanLimits{
			MaxRows:          MaxCurrentConfigurationRenameToolkits + 1,
			MaxSettingsBytes: MaxCurrentConfigurationRenameSettingsBytes,
			MaxTotalBytes:    MaxCurrentConfigurationRenameTotalBytes,
		},
	)
	if err != nil {
		if errors.Is(err, ErrCurrentConfigurationLifecycleInternalLimit) {
			return ErrCurrentConfigurationLifecycleInternalLimit
		}
		return currentConfigurationLifecycleInternalDependencyError(ctx, err)
	}
	if len(toolkits) > MaxCurrentConfigurationRenameToolkits {
		return ErrCurrentConfigurationLifecycleInternalLimit
	}

	totalBytes := 0
	seen := make(map[int32]struct{}, len(toolkits))
	proposals := make([]currentConfigurationRenameProposal, 0, len(toolkits))
	for _, toolkit := range toolkits {
		if err := ctx.Err(); err != nil {
			return err
		}
		if _, duplicate := seen[toolkit.ToolkitID]; duplicate {
			return ErrInvalidCurrentConfigurationLifecycleInternalEffect
		}
		seen[toolkit.ToolkitID] = struct{}{}
		totalBytes += len(toolkit.Settings)
		if totalBytes > MaxCurrentConfigurationRenameTotalBytes {
			return ErrCurrentConfigurationLifecycleInternalLimit
		}
		rewritten, changed, err := rewriteCurrentConfigurationReferences(
			toolkit,
			effect.BeforeTitle,
			effect.AfterTitle,
		)
		if err != nil {
			return err
		}
		if changed {
			proposals = append(proposals, currentConfigurationRenameProposal{
				Toolkit:  toolkit,
				Settings: rewritten,
			})
		}
	}

	for _, proposal := range proposals {
		if err := e.applyCurrentConfigurationRenameProposal(ctx, effect, proposal); err != nil {
			return err
		}
	}
	return nil
}

type currentConfigurationRenameProposal struct {
	Toolkit  CurrentConfigurationRenameToolkit
	Settings json.RawMessage
}

func (e *CurrentConfigurationRenameReferenceEffect) applyCurrentConfigurationRenameProposal(
	ctx context.Context,
	effect CurrentConfigurationRenameEffect,
	proposal currentConfigurationRenameProposal,
) error {
	toolkit := proposal.Toolkit
	settings := proposal.Settings
	for attempt := 0; attempt < MaxCurrentConfigurationRenameCASAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		updated, err := e.repository.CompareAndSwapCurrentConfigurationRenameToolkit(
			ctx,
			CurrentConfigurationRenameToolkitUpdate{
				ProjectID:       effect.ProjectID,
				ToolkitID:       toolkit.ToolkitID,
				ExpectedVersion: toolkit.Version,
				Settings:        settings,
			},
		)
		if err != nil {
			return currentConfigurationLifecycleInternalDependencyError(ctx, err)
		}
		if updated {
			return nil
		}

		fresh, found, err := e.repository.GetCurrentConfigurationRenameToolkit(
			ctx,
			effect.ProjectID,
			toolkit.ToolkitID,
		)
		if err != nil {
			return currentConfigurationLifecycleInternalDependencyError(ctx, err)
		}
		if !found {
			return nil
		}
		settings, updated, err = rewriteCurrentConfigurationReferences(
			fresh,
			effect.BeforeTitle,
			effect.AfterTitle,
		)
		if err != nil {
			return err
		}
		if !updated {
			return nil
		}
		toolkit = fresh
	}
	return ErrCurrentConfigurationLifecycleInternalConflict
}

func validCurrentConfigurationRenameEffect(
	ctx context.Context,
	service *CurrentConfigurationRenameReferenceEffect,
	effect CurrentConfigurationRenameEffect,
) bool {
	return ctx != nil && service != nil && service.repository != nil &&
		validCurrentConfigurationLifecycleIdentity(effect.EffectID) &&
		validCurrentConfigurationLifecycleIdentity(effect.EventID) && effect.Revision > 0 &&
		effect.ProjectID > 0 && validCurrentConfigurationLifecycleIdentity(effect.ConfigurationUUID) &&
		validCurrentConfigurationRenameIdentity(effect.Type) &&
		validCurrentConfigurationRenameIdentity(effect.BeforeTitle) &&
		validCurrentConfigurationRenameIdentity(effect.AfterTitle) &&
		effect.BeforeTitle != effect.AfterTitle
}

func validCurrentConfigurationRenameIdentity(value string) bool {
	return value != "" && len(value) <= MaxCurrentConfigurationRenameIdentityBytes &&
		value == strings.TrimSpace(value) && !strings.ContainsRune(value, '\x00')
}

func rewriteCurrentConfigurationReferences(
	toolkit CurrentConfigurationRenameToolkit,
	beforeTitle string,
	afterTitle string,
) (json.RawMessage, bool, error) {
	if toolkit.ToolkitID <= 0 || !validCurrentConfigurationLifecycleIdentity(toolkit.Version) ||
		len(toolkit.Settings) == 0 {
		return nil, false, ErrInvalidCurrentConfigurationLifecycleInternalEffect
	}
	if len(toolkit.Settings) > MaxCurrentConfigurationRenameSettingsBytes {
		return nil, false, ErrCurrentConfigurationLifecycleInternalLimit
	}

	decoder := json.NewDecoder(bytes.NewReader(toolkit.Settings))
	decoder.UseNumber()
	var document any
	if err := decoder.Decode(&document); err != nil {
		return nil, false, ErrInvalidCurrentConfigurationLifecycleInternalEffect
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return nil, false, ErrInvalidCurrentConfigurationLifecycleInternalEffect
	}

	budget := currentConfigurationRenameJSONBudget{}
	changed, err := replaceCurrentConfigurationReference(
		document,
		beforeTitle,
		afterTitle,
		1,
		&budget,
	)
	if err != nil || !changed {
		return nil, changed, err
	}
	rewritten, err := json.Marshal(document)
	if err != nil {
		return nil, false, ErrInvalidCurrentConfigurationLifecycleInternalEffect
	}
	if len(rewritten) > MaxCurrentConfigurationRenameSettingsBytes {
		return nil, false, ErrCurrentConfigurationLifecycleInternalLimit
	}
	return rewritten, true, nil
}

type currentConfigurationRenameJSONBudget struct {
	nodes int
}

func replaceCurrentConfigurationReference(
	value any,
	beforeTitle string,
	afterTitle string,
	depth int,
	budget *currentConfigurationRenameJSONBudget,
) (bool, error) {
	if depth > MaxCurrentConfigurationRenameDepth {
		return false, ErrCurrentConfigurationLifecycleInternalLimit
	}
	budget.nodes++
	if budget.nodes > MaxCurrentConfigurationRenameNodes {
		return false, ErrCurrentConfigurationLifecycleInternalLimit
	}

	switch typed := value.(type) {
	case map[string]any:
		_, hasPrivate := typed["private"]
		if title, ok := typed["elitea_title"].(string); ok && title == beforeTitle && hasPrivate {
			typed["elitea_title"] = afterTitle
			return true, nil
		}
		changed := false
		for _, nested := range typed {
			nestedChanged, err := replaceCurrentConfigurationReference(
				nested,
				beforeTitle,
				afterTitle,
				depth+1,
				budget,
			)
			if err != nil {
				return false, err
			}
			changed = changed || nestedChanged
		}
		return changed, nil
	case []any:
		changed := false
		for _, nested := range typed {
			nestedChanged, err := replaceCurrentConfigurationReference(
				nested,
				beforeTitle,
				afterTitle,
				depth+1,
				budget,
			)
			if err != nil {
				return false, err
			}
			changed = changed || nestedChanged
		}
		return changed, nil
	default:
		return false, nil
	}
}

var _ CurrentConfigurationRenameEffects = (*CurrentConfigurationRenameReferenceEffect)(nil)
