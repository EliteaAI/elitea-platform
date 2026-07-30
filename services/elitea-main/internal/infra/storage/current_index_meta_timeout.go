package storage

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/centrysecrets"
)

const (
	currentIndexMetaStaleTimeoutKey     = "task_disconnected_timeout_sec"
	defaultCurrentIndexMetaStaleTimeout = 7200 * time.Second
)

var ErrCurrentIndexMetaTimeoutUnavailable = errors.New("current index meta timeout is unavailable")

// CurrentIndexMetaTimeoutResolver reads the regular project-vault setting used
// by the current Python index_meta endpoint. It does not fall back to public or
// admin secrets, and a missing key preserves the exact 7200-second default.
type CurrentIndexMetaTimeoutResolver struct {
	vaults SecretVaultLoader
}

func NewCurrentIndexMetaTimeoutResolver(vaults SecretVaultLoader) (*CurrentIndexMetaTimeoutResolver, error) {
	if vaults == nil {
		return nil, errors.New("current index meta vault loader is required")
	}
	return &CurrentIndexMetaTimeoutResolver{vaults: vaults}, nil
}

func (r *CurrentIndexMetaTimeoutResolver) ResolveCurrentIndexMetaStaleTimeout(
	ctx context.Context,
	projectID int32,
) (time.Duration, error) {
	if r == nil || r.vaults == nil || ctx == nil || projectID <= 0 {
		return 0, ErrCurrentIndexMetaTimeoutUnavailable
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}

	vault, err := r.vaults.LoadProjectVault(ctx, int64(projectID))
	if err != nil || vault == nil {
		return 0, currentIndexMetaTimeoutError(ctx, err)
	}
	secret, err := vault.LookupRegularInteger(currentIndexMetaStaleTimeoutKey)
	if errors.Is(err, centrysecrets.ErrSecretNotFound) {
		return defaultCurrentIndexMetaStaleTimeout, nil
	}
	if err != nil {
		return 0, currentIndexMetaTimeoutError(ctx, err)
	}

	seconds, err := strconv.ParseInt(secret.Value, 10, 64)
	if err != nil || seconds > int64(time.Duration(1<<63-1)/time.Second) ||
		seconds < int64(time.Duration(-1<<63)/time.Second) {
		return 0, ErrCurrentIndexMetaTimeoutUnavailable
	}
	return time.Duration(seconds) * time.Second, nil
}

func currentIndexMetaTimeoutError(ctx context.Context, cause error) error {
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
	return ErrCurrentIndexMetaTimeoutUnavailable
}
