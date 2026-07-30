package configurations

import (
	"context"
	"errors"
)

var (
	ErrInvalidCurrentConfigurationLifecycleInternalEffect = errors.New("invalid current configuration lifecycle internal effect")
	ErrCurrentConfigurationLifecycleInternalUnavailable   = errors.New("current configuration lifecycle internal effect unavailable")
	ErrCurrentConfigurationLifecycleInternalLimit         = errors.New("current configuration lifecycle internal effect exceeds its limit")
	ErrCurrentConfigurationLifecycleInternalConflict      = errors.New("current configuration lifecycle internal effect conflicted")
	ErrCurrentDeletedLLMDefaultUnavailable                = errors.New("current deleted LLM default is unavailable")
)

// currentConfigurationLifecycleInternalDependencyError keeps dependency text,
// which may contain configuration data, out of processor errors. The lifecycle
// reconciler maps this sentinel to its stable operation-specific retry code.
func currentConfigurationLifecycleInternalDependencyError(ctx context.Context, cause error) error {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	if errors.Is(cause, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(cause, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return ErrCurrentConfigurationLifecycleInternalUnavailable
}
