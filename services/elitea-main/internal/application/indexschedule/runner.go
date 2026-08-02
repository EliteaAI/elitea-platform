package indexschedule

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	currentScheduleProjectPageSize = 128
	currentScheduleToolkitPageSize = 128
	currentScheduleKeyPrefix       = "index-schedule-v1:"
	currentScheduleActionID        = "index.schedule.scan.v1"
	currentScheduleRevisionPrefix  = "index-schedule-definition-v1:"
)

type Candidate struct {
	ProjectID      int64
	ToolkitID      int64
	ToolkitType    string
	IndexMetaID    string
	ScheduleUserID int64
	Schedule       Schedule
}

type ToolkitSchedules struct {
	ProjectID  int64
	ToolkitID  int64
	Candidates []Candidate
}

type Catalog interface {
	ListProjectPage(context.Context, int64, int) ([]int64, error)
	ListToolkitSchedulePage(context.Context, int64, int64, int) ([]ToolkitSchedules, error)
	MarkLastRun(context.Context, Candidate, time.Time) (bool, error)
}

type Availability interface {
	SchedulingAvailable(context.Context) (bool, error)
}

type ExecutionDisposition uint8

const (
	ExecutionAdmitted ExecutionDisposition = iota + 1
	ExecutionIdempotent
	ExecutionSkippedActive
	ExecutionSkippedUnavailable
	ExecutionInitializationFailed
)

type ExecutionOutcome struct {
	Disposition ExecutionDisposition
	SafeReason  string
}

type Executor interface {
	ExecuteScheduled(context.Context, Candidate, time.Time, string) (ExecutionOutcome, error)
}

type FailureRecorder interface {
	RecordScheduleFailure(context.Context, Candidate, string, time.Time) error
}

type TickResult struct {
	SkippedUnavailable bool
	SkippedOverlap     bool
	Projects           int
	Toolkits           int
	Candidates         int
	Invalid            int
	NotDue             int
	Skipped            int
	Failed             int
	Admitted           int
	Idempotent         int
	LastRunUpdated     int
	ChangedBeforeMark  int
	DependencyErrors   int
}

// Runner is the indexing adapter behind the platform scheduler. It owns only
// bounded product-aware discovery and durable index admission; cadence and
// distributed occurrence ownership belong to the generic scheduling kernel.
type Runner struct {
	catalog      Catalog
	availability Availability
	executor     Executor
	failures     FailureRecorder
	now          func() time.Time
	ticking      atomic.Bool
}

func NewRunner(
	catalog Catalog,
	availability Availability,
	executor Executor,
	failures FailureRecorder,
) (*Runner, error) {
	return newRunner(
		catalog,
		availability,
		executor,
		failures,
		time.Now,
	)
}

func newRunner(
	catalog Catalog,
	availability Availability,
	executor Executor,
	failures FailureRecorder,
	now func() time.Time,
) (*Runner, error) {
	if catalog == nil || availability == nil || executor == nil ||
		failures == nil || now == nil {
		return nil, errors.New("index schedule runner dependencies are required")
	}
	return &Runner{
		catalog: catalog, availability: availability, executor: executor,
		failures: failures, now: now,
	}, nil
}

func (runner *Runner) RunDue(ctx context.Context, scanTime time.Time) (
	result TickResult,
	err error,
) {
	if runner == nil || runner.catalog == nil || runner.availability == nil ||
		runner.executor == nil || runner.failures == nil ||
		runner.now == nil || ctx == nil || scanTime.IsZero() {
		return TickResult{}, ErrInvalidRequest
	}
	if err := ctx.Err(); err != nil {
		return TickResult{}, err
	}
	if !runner.ticking.CompareAndSwap(false, true) {
		return TickResult{SkippedOverlap: true}, nil
	}
	defer runner.ticking.Store(false)

	available, err := runner.availability.SchedulingAvailable(ctx)
	if err != nil {
		return TickResult{}, dependencyError(ctx, err)
	}
	if !available {
		return TickResult{SkippedUnavailable: true}, nil
	}

	scanTime = scanTime.UTC()
	var projectCursor int64
	for {
		projects, err := runner.catalog.ListProjectPage(
			ctx,
			projectCursor,
			currentScheduleProjectPageSize,
		)
		if err != nil {
			return result, dependencyError(ctx, err)
		}
		if err := validateProjectPage(projects, projectCursor); err != nil {
			return result, err
		}
		if len(projects) == 0 {
			return result, nil
		}
		for _, projectID := range projects {
			if err := ctx.Err(); err != nil {
				return result, err
			}
			result.Projects++
			if err := runner.scanProject(ctx, projectID, scanTime, &result); err != nil {
				return result, err
			}
		}
		projectCursor = projects[len(projects)-1]
		if len(projects) < currentScheduleProjectPageSize {
			return result, nil
		}
	}
}

func (runner *Runner) scanProject(
	ctx context.Context,
	projectID int64,
	scanTime time.Time,
	result *TickResult,
) error {
	var toolkitCursor int64
	for {
		page, err := runner.catalog.ListToolkitSchedulePage(
			ctx,
			projectID,
			toolkitCursor,
			currentScheduleToolkitPageSize,
		)
		if err != nil {
			return dependencyError(ctx, err)
		}
		if err := validateToolkitPage(page, projectID, toolkitCursor); err != nil {
			return err
		}
		if len(page) == 0 {
			return nil
		}
		for _, toolkit := range page {
			if err := ctx.Err(); err != nil {
				return err
			}
			result.Toolkits++
			for _, candidate := range toolkit.Candidates {
				if err := ctx.Err(); err != nil {
					return err
				}
				if err := runner.executeCandidate(
					ctx,
					candidate,
					scanTime,
					result,
				); err != nil {
					return err
				}
			}
		}
		toolkitCursor = page[len(page)-1].ToolkitID
		if len(page) < currentScheduleToolkitPageSize {
			return nil
		}
	}
}

func (runner *Runner) executeCandidate(
	ctx context.Context,
	candidate Candidate,
	scanTime time.Time,
	result *TickResult,
) error {
	result.Candidates++
	if !validCandidate(candidate) {
		result.Invalid++
		return nil
	}
	occurrence, due, err := DueOccurrence(candidate.Schedule, scanTime)
	if err != nil {
		result.Invalid++
		return nil
	}
	if !due {
		result.NotDue++
		return nil
	}
	idempotencyKey := StableIdempotencyKey(candidate, occurrence)
	outcome, err := runner.executor.ExecuteScheduled(
		ctx,
		candidate,
		occurrence,
		idempotencyKey,
	)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
		if errors.Is(err, context.Canceled) ||
			errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		result.DependencyErrors++
		return nil
	}
	switch outcome.Disposition {
	case ExecutionSkippedActive, ExecutionSkippedUnavailable:
		result.Skipped++
		return nil
	case ExecutionInitializationFailed:
		if !validSafeReason(outcome.SafeReason) {
			result.Invalid++
			return nil
		}
		if err := runner.failures.RecordScheduleFailure(
			ctx,
			candidate,
			outcome.SafeReason,
			occurrence,
		); err != nil {
			if contextErr := ctx.Err(); contextErr != nil {
				return contextErr
			}
			if errors.Is(err, context.Canceled) ||
				errors.Is(err, context.DeadlineExceeded) {
				return err
			}
			result.DependencyErrors++
			return nil
		}
		result.Failed++
		return nil
	case ExecutionAdmitted:
		result.Admitted++
	case ExecutionIdempotent:
		result.Idempotent++
	default:
		result.Invalid++
		return nil
	}
	updated, err := runner.catalog.MarkLastRun(
		ctx,
		candidate,
		runner.now().UTC(),
	)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
		if errors.Is(err, context.Canceled) ||
			errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		result.DependencyErrors++
		return nil
	}
	if updated {
		result.LastRunUpdated++
	} else {
		result.ChangedBeforeMark++
	}
	return nil
}

func StableIdempotencyKey(candidate Candidate, occurrence time.Time) string {
	revision := ScheduleRevision(candidate.Schedule)
	hash := sha256.New()
	for _, value := range []string{
		currentScheduleActionID,
		strconv.FormatInt(candidate.ProjectID, 10),
		strconv.FormatInt(candidate.ToolkitID, 10),
		candidate.IndexMetaID,
		strconv.FormatInt(candidate.ScheduleUserID, 10),
		revision,
		occurrence.UTC().Format(time.RFC3339Nano),
	} {
		writeScheduleHashValue(hash, value)
	}
	return currentScheduleKeyPrefix + hex.EncodeToString(hash.Sum(nil))
}

// ScheduleRevision fingerprints only the reference-only schedule semantics.
// LastRun is deliberately excluded because it is mutable occurrence progress.
// Credential secret values are never stored in this object; EliteaTitle is the
// stable Configurations reference and nullable Private remains significant.
func ScheduleRevision(schedule Schedule) string {
	privateState := "credentials-absent"
	credentialTitle := ""
	if schedule.Credentials != nil {
		privateState = "private-null"
		credentialTitle = schedule.Credentials.EliteaTitle
		if schedule.Credentials.Private != nil {
			privateState = strconv.FormatBool(*schedule.Credentials.Private)
		}
	}
	hash := sha256.New()
	for _, value := range []string{
		currentScheduleActionID,
		schedule.Cron,
		strconv.FormatBool(schedule.Enabled),
		strconv.FormatInt(schedule.CreatedBy, 10),
		schedule.Timezone,
		privateState,
		credentialTitle,
	} {
		writeScheduleHashValue(hash, value)
	}
	return currentScheduleRevisionPrefix + hex.EncodeToString(hash.Sum(nil))
}

type scheduleHashWriter interface {
	Write([]byte) (int, error)
}

func writeScheduleHashValue(hash scheduleHashWriter, value string) {
	var length [8]byte
	binary.BigEndian.PutUint64(length[:], uint64(len(value)))
	_, _ = hash.Write(length[:])
	_, _ = hash.Write([]byte(value))
}

func validCandidate(candidate Candidate) bool {
	return candidate.ProjectID > 0 &&
		candidate.ToolkitID > 0 &&
		candidate.ToolkitType != "" &&
		len(candidate.ToolkitType) <= MaxCredentialTitleBytes &&
		!strings.ContainsAny(candidate.ToolkitType, "\x00\r\n") &&
		validIndexMetaID(candidate.IndexMetaID) &&
		(candidate.ScheduleUserID == -1 || candidate.ScheduleUserID > 0) &&
		candidate.Schedule.CreatedBy > 0 &&
		(candidate.ScheduleUserID == -1 ||
			candidate.ScheduleUserID == candidate.Schedule.CreatedBy)
}

func validateProjectPage(projects []int64, after int64) error {
	if len(projects) > currentScheduleProjectPageSize {
		return ErrScheduleDependency
	}
	previous := after
	for _, projectID := range projects {
		if projectID <= previous {
			return ErrScheduleDependency
		}
		previous = projectID
	}
	return nil
}

func validateToolkitPage(
	page []ToolkitSchedules,
	projectID, after int64,
) error {
	if len(page) > currentScheduleToolkitPageSize {
		return ErrScheduleDependency
	}
	previous := after
	for _, toolkit := range page {
		if toolkit.ProjectID != projectID || toolkit.ToolkitID <= previous {
			return ErrScheduleDependency
		}
		for _, candidate := range toolkit.Candidates {
			if candidate.ProjectID != projectID ||
				candidate.ToolkitID != toolkit.ToolkitID {
				return ErrScheduleDependency
			}
		}
		previous = toolkit.ToolkitID
	}
	return nil
}

func validSafeReason(value string) bool {
	return value != "" && len(value) <= 512 &&
		!strings.ContainsAny(value, "\x00\r\n")
}

func dependencyError(ctx context.Context, cause error) error {
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
	return errors.Join(ErrScheduleDependency, cause)
}
