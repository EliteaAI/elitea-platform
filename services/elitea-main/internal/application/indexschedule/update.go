// Package indexschedule owns the current index schedule PATCH contract.
//
// It deliberately does not own schedule discovery or execution. During this
// stage Pylon remains the only scheduler, while Main can persist the exact
// nested schedule shape consumed by that scheduler.
package indexschedule

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"
)

const (
	MaxCronBytes            = 256
	MaxTimezoneBytes        = 256
	MaxIndexMetaIDBytes     = 4 << 10
	MaxCredentialTitleBytes = 4 << 10
	DailyProbeFirings       = 32
)

var (
	ErrInvalidRequest         = errors.New("invalid index schedule request")
	ErrInvalidCron            = errors.New("invalid cron expression")
	ErrFrequencyAboveDaily    = errors.New("frequency cannot be more than once per day")
	ErrInvalidTimezone        = errors.New("invalid schedule timezone")
	ErrToolkitNotFound        = errors.New("schedule toolkit was not found")
	ErrInvalidToolkit         = errors.New("schedule toolkit is invalid")
	ErrScheduleUnavailable    = errors.New("index schedule storage is unavailable")
	ErrScheduleResultTooLarge = errors.New("index schedule metadata exceeds its limit")
)

type Credentials struct {
	// Private is nullable because the current Pydantic contract preserves an
	// explicitly supplied JSON null. The HTTP decoder supplies false when the
	// field is omitted, matching the current model default.
	Private     *bool  `json:"private"`
	EliteaTitle string `json:"elitea_title"`
}

// Update is transport-decoded input after authentication and project RBAC.
// RequestedUserID is -1 when the current payload omits user_id.
type Update struct {
	ProjectID       int64
	ActorUserID     int64
	ToolkitID       int64
	IndexMetaID     string
	Cron            string
	Enabled         bool
	RequestedUserID int64
	Credentials     *Credentials
	Timezone        string
}

// Schedule is the exact current object persisted below
// meta.indexes_meta[indexMetaID].schedules[userID].
type Schedule struct {
	Cron        string       `json:"cron"`
	Enabled     bool         `json:"enabled"`
	Credentials *Credentials `json:"credentials"`
	CreatedBy   int64        `json:"created_by"`
	Timezone    string       `json:"timezone"`
	LastRun     string       `json:"last_run"`
}

type Mutation struct {
	ProjectID       int64
	ActorUserID     int64
	ToolkitID       int64
	IndexMetaID     string
	RequestedUserID int64
	Schedule        Schedule
}

type MutationResult struct {
	IndexesMeta     map[string]any
	EffectiveUserID int64
}

type Store interface {
	Patch(context.Context, Mutation) (MutationResult, error)
}

type Service struct {
	store Store
	now   func() time.Time
}

func NewService(store Store) (*Service, error) {
	return newService(store, time.Now)
}

func newService(store Store, now func() time.Time) (*Service, error) {
	if store == nil || now == nil {
		return nil, errors.New("index schedule dependencies are required")
	}
	return &Service{store: store, now: now}, nil
}

func (service *Service) Update(
	ctx context.Context,
	update Update,
) (MutationResult, error) {
	if service == nil || service.store == nil || service.now == nil || ctx == nil ||
		update.ProjectID <= 0 || update.ProjectID > math.MaxInt32 ||
		update.ActorUserID <= 0 || update.ActorUserID > math.MaxInt32 ||
		update.ToolkitID <= 0 || update.ToolkitID > math.MaxInt32 ||
		!validIndexMetaID(update.IndexMetaID) {
		return MutationResult{}, ErrInvalidRequest
	}
	if err := ctx.Err(); err != nil {
		return MutationResult{}, err
	}
	normalizedCron, err := ValidateUpdateCron(update.Cron)
	if err != nil {
		return MutationResult{}, err
	}
	if err := ValidateTimezone(update.Timezone); err != nil {
		return MutationResult{}, err
	}
	if update.Credentials != nil &&
		(len(update.Credentials.EliteaTitle) > MaxCredentialTitleBytes ||
			strings.ContainsRune(update.Credentials.EliteaTitle, '\x00')) {
		return MutationResult{}, ErrInvalidRequest
	}
	// A positive schedule key selects a personal credential scope. Only the
	// authenticated owner may select that scope; -1 remains the project/team
	// schedule key. Trusting an arbitrary caller-supplied user ID would allow
	// one project member to redeem another member's private configuration.
	if update.RequestedUserID != -1 &&
		update.RequestedUserID != update.ActorUserID {
		return MutationResult{}, ErrInvalidRequest
	}

	return service.store.Patch(ctx, Mutation{
		ProjectID:       update.ProjectID,
		ActorUserID:     update.ActorUserID,
		ToolkitID:       update.ToolkitID,
		IndexMetaID:     update.IndexMetaID,
		RequestedUserID: update.RequestedUserID,
		Schedule: Schedule{
			Cron:        normalizedCron,
			Enabled:     update.Enabled,
			Credentials: cloneCredentials(update.Credentials),
			CreatedBy:   update.ActorUserID,
			Timezone:    update.Timezone,
			LastRun:     formatCurrentUTC(service.now()),
		},
	})
}

func validIndexMetaID(value string) bool {
	return value != "" && len(value) <= MaxIndexMetaIDBytes &&
		!strings.ContainsAny(value, "\x00\r\n/")
}

func cloneCredentials(value *Credentials) *Credentials {
	if value == nil {
		return nil
	}
	cloned := *value
	if value.Private != nil {
		private := *value.Private
		cloned.Private = &private
	}
	return &cloned
}

func formatCurrentUTC(value time.Time) string {
	value = value.UTC().Truncate(time.Microsecond)
	if value.Nanosecond() == 0 {
		return value.Format("2006-01-02T15:04:05+00:00")
	}
	return value.Format("2006-01-02T15:04:05.000000+00:00")
}
