package indexschedule

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type scheduleCatalogStub struct {
	mu           sync.Mutex
	projects     []int64
	toolkits     map[int64][]ToolkitSchedules
	projectCalls []int64
	toolkitCalls map[int64][]int64
	marked       []Candidate
	markedAt     []time.Time
	markChanged  bool
	blockPage    chan struct{}
}

func (stub *scheduleCatalogStub) ListProjectPage(
	ctx context.Context,
	after int64,
	limit int,
) ([]int64, error) {
	if stub.blockPage != nil {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-stub.blockPage:
		}
	}
	stub.mu.Lock()
	defer stub.mu.Unlock()
	stub.projectCalls = append(stub.projectCalls, after)
	page := make([]int64, 0, limit)
	for _, projectID := range stub.projects {
		if projectID > after && len(page) < limit {
			page = append(page, projectID)
		}
	}
	return page, nil
}

func (stub *scheduleCatalogStub) ListToolkitSchedulePage(
	_ context.Context,
	projectID int64,
	after int64,
	limit int,
) ([]ToolkitSchedules, error) {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	if stub.toolkitCalls == nil {
		stub.toolkitCalls = map[int64][]int64{}
	}
	stub.toolkitCalls[projectID] = append(stub.toolkitCalls[projectID], after)
	page := make([]ToolkitSchedules, 0, limit)
	for _, toolkit := range stub.toolkits[projectID] {
		if toolkit.ToolkitID > after && len(page) < limit {
			page = append(page, toolkit)
		}
	}
	return page, nil
}

func (stub *scheduleCatalogStub) MarkLastRun(
	_ context.Context,
	candidate Candidate,
	at time.Time,
) (bool, error) {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	stub.marked = append(stub.marked, candidate)
	stub.markedAt = append(stub.markedAt, at)
	return stub.markChanged, nil
}

func (stub *scheduleCatalogStub) projectCallsSnapshot() []int64 {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	return append([]int64(nil), stub.projectCalls...)
}

type scheduleAvailabilityStub struct {
	available bool
	err       error
}

func (stub scheduleAvailabilityStub) SchedulingAvailable(context.Context) (bool, error) {
	return stub.available, stub.err
}

type scheduleExecutorStub struct {
	mu       sync.Mutex
	outcomes map[string]ExecutionOutcome
	errs     map[string]error
	keys     []string
}

func (stub *scheduleExecutorStub) ExecuteScheduled(
	_ context.Context,
	candidate Candidate,
	_ time.Time,
	key string,
) (ExecutionOutcome, error) {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	stub.keys = append(stub.keys, key)
	if err := stub.errs[candidate.IndexMetaID]; err != nil {
		return ExecutionOutcome{}, err
	}
	if outcome, ok := stub.outcomes[candidate.IndexMetaID]; ok {
		return outcome, nil
	}
	return ExecutionOutcome{Disposition: ExecutionAdmitted}, nil
}

type scheduleFailureStub struct {
	mu       sync.Mutex
	recorded []Candidate
}

func (stub *scheduleFailureStub) RecordScheduleFailure(
	_ context.Context,
	candidate Candidate,
	_ string,
	_ time.Time,
) error {
	stub.mu.Lock()
	defer stub.mu.Unlock()
	stub.recorded = append(stub.recorded, candidate)
	return nil
}

func TestRunnerTickPagesAndPreservesDispositionSemantics(t *testing.T) {
	now := time.Date(2026, 7, 28, 4, 0, 0, 0, time.UTC)
	candidates := []Candidate{
		dueCandidate(1, 1, "admitted"),
		dueCandidate(1, 1, "idempotent"),
		dueCandidate(1, 1, "active"),
		dueCandidate(1, 1, "failure"),
		dueCandidate(1, 1, "dependency"),
	}
	catalog := &scheduleCatalogStub{
		projects: []int64{1},
		toolkits: map[int64][]ToolkitSchedules{
			1: {{ProjectID: 1, ToolkitID: 1, Candidates: candidates}},
		},
		markChanged: true,
	}
	executor := &scheduleExecutorStub{
		outcomes: map[string]ExecutionOutcome{
			"idempotent": {Disposition: ExecutionIdempotent},
			"active":     {Disposition: ExecutionSkippedActive},
			"failure": {
				Disposition: ExecutionInitializationFailed,
				SafeReason:  "toolkit credentials resolving issue",
			},
		},
		errs: map[string]error{"dependency": errors.New("unavailable")},
	}
	failures := &scheduleFailureStub{}
	runner, err := newRunner(
		catalog,
		scheduleAvailabilityStub{available: true},
		executor,
		failures,
		func() time.Time { return now },
	)
	if err != nil {
		t.Fatal(err)
	}

	result, err := runner.RunDue(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	if result.Projects != 1 || result.Toolkits != 1 || result.Candidates != 5 ||
		result.Admitted != 1 || result.Idempotent != 1 || result.Skipped != 1 ||
		result.Failed != 1 || result.DependencyErrors != 1 ||
		result.LastRunUpdated != 2 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(catalog.marked) != 2 || len(failures.recorded) != 1 ||
		len(executor.keys) != 5 {
		t.Fatalf(
			"marked=%d failures=%d keys=%d",
			len(catalog.marked),
			len(failures.recorded),
			len(executor.keys),
		)
	}
	if executor.keys[0] == executor.keys[1] {
		t.Fatal("different index identities produced the same idempotency key")
	}
}

func TestRunnerTickSkipsUnavailableWithoutScanning(t *testing.T) {
	catalog := &scheduleCatalogStub{}
	runner, err := newRunner(
		catalog,
		scheduleAvailabilityStub{},
		&scheduleExecutorStub{},
		&scheduleFailureStub{},
		time.Now,
	)
	if err != nil {
		t.Fatal(err)
	}
	result, err := runner.RunDue(context.Background(), time.Now())
	projectCalls := catalog.projectCallsSnapshot()
	if err != nil || !result.SkippedUnavailable || len(projectCalls) != 0 {
		t.Fatalf("Tick() result=%+v error=%v calls=%v", result, err, projectCalls)
	}
}

func TestRunnerMarksLastRunAtSuccessfulAdmissionCompletion(t *testing.T) {
	scanTime := time.Date(2026, 7, 28, 4, 0, 0, 0, time.UTC)
	completedAt := scanTime.Add(9 * time.Second)
	catalog := &scheduleCatalogStub{
		projects: []int64{1},
		toolkits: map[int64][]ToolkitSchedules{
			1: {{
				ProjectID: 1,
				ToolkitID: 1,
				Candidates: []Candidate{
					dueCandidate(1, 1, "docs"),
				},
			}},
		},
		markChanged: true,
	}
	runner, err := newRunner(
		catalog,
		scheduleAvailabilityStub{available: true},
		&scheduleExecutorStub{},
		&scheduleFailureStub{},
		func() time.Time { return completedAt },
	)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := runner.RunDue(context.Background(), scanTime); err != nil {
		t.Fatal(err)
	}
	if len(catalog.markedAt) != 1 ||
		!catalog.markedAt[0].Equal(completedAt) {
		t.Fatalf("last_run marks=%v want=%v", catalog.markedAt, completedAt)
	}
}

func TestRunnerTickDoesNotOverlap(t *testing.T) {
	block := make(chan struct{})
	catalog := &scheduleCatalogStub{blockPage: block}
	runner, err := newRunner(
		catalog,
		scheduleAvailabilityStub{available: true},
		&scheduleExecutorStub{},
		&scheduleFailureStub{},
		time.Now,
	)
	if err != nil {
		t.Fatal(err)
	}
	firstDone := make(chan error, 1)
	go func() {
		_, tickErr := runner.RunDue(context.Background(), time.Now())
		firstDone <- tickErr
	}()
	for !runner.ticking.Load() {
		time.Sleep(time.Millisecond)
	}
	result, err := runner.RunDue(context.Background(), time.Now())
	if err != nil || !result.SkippedOverlap {
		t.Fatalf("overlapping Tick() result=%+v error=%v", result, err)
	}
	close(block)
	if err := <-firstDone; err != nil {
		t.Fatal(err)
	}
}

func TestRunnerTickPropagatesCancellationFromCandidateExecution(t *testing.T) {
	catalog := &scheduleCatalogStub{
		projects: []int64{1},
		toolkits: map[int64][]ToolkitSchedules{
			1: {{
				ProjectID: 1,
				ToolkitID: 1,
				Candidates: []Candidate{
					dueCandidate(1, 1, "cancelled"),
					dueCandidate(1, 1, "must-not-run"),
				},
			}},
		},
	}
	executor := &scheduleExecutorStub{
		errs: map[string]error{"cancelled": context.Canceled},
	}
	runner, err := newRunner(
		catalog,
		scheduleAvailabilityStub{available: true},
		executor,
		&scheduleFailureStub{},
		func() time.Time { return time.Date(2026, 7, 28, 4, 0, 0, 0, time.UTC) },
	)
	if err != nil {
		t.Fatal(err)
	}

	result, err := runner.RunDue(
		context.Background(),
		time.Date(2026, 7, 28, 4, 0, 0, 0, time.UTC),
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Tick() error=%v", err)
	}
	if result.Candidates != 1 || len(executor.keys) != 1 {
		t.Fatalf("Tick() continued after cancellation: result=%+v keys=%d", result, len(executor.keys))
	}
}

func TestStableIdempotencyKeyUsesDueOccurrenceNotScanTime(t *testing.T) {
	candidate := dueCandidate(7, 9, "docs")
	occurrence := time.Date(2026, 7, 28, 3, 0, 0, 0, time.UTC)
	first := StableIdempotencyKey(candidate, occurrence)
	second := StableIdempotencyKey(candidate, occurrence.In(time.FixedZone("other", 3*60*60)))
	if first != second || len(first) != len(currentScheduleKeyPrefix)+sha256HexBytes {
		t.Fatalf("stable key mismatch: %q %q", first, second)
	}
	candidate.Schedule.LastRun = "different scan state"
	if StableIdempotencyKey(candidate, occurrence) != first {
		t.Fatal("mutable last_run changed the due-occurrence identity")
	}
}

func TestStableIdempotencyKeyIncludesExactScheduleRevision(t *testing.T) {
	occurrence := time.Date(2026, 7, 28, 3, 0, 0, 0, time.UTC)
	private := true
	candidate := dueCandidate(7, 9, "docs")
	candidate.Schedule.Credentials = &Credentials{
		Private:     &private,
		EliteaTitle: "github-personal",
	}
	first := StableIdempotencyKey(candidate, occurrence)
	firstRevision := ScheduleRevision(candidate.Schedule)

	edited := candidate
	otherPrivate := true
	edited.Schedule.Credentials = &Credentials{
		Private:     &otherPrivate,
		EliteaTitle: "github-rotated-reference",
	}
	if StableIdempotencyKey(edited, occurrence) == first ||
		ScheduleRevision(edited.Schedule) == firstRevision {
		t.Fatal("same-occurrence schedule edit collided with the old admission")
	}

	edited.Schedule = candidate.Schedule
	edited.Schedule.LastRun = occurrence.Add(time.Minute).Format(time.RFC3339)
	if StableIdempotencyKey(edited, occurrence) != first ||
		ScheduleRevision(edited.Schedule) != firstRevision {
		t.Fatal("mutable occurrence progress changed the schedule revision")
	}

	edited.Schedule = candidate.Schedule
	edited.Schedule.Credentials = nil
	if StableIdempotencyKey(edited, occurrence) == first {
		t.Fatal("absent and concrete credential references collided")
	}
	edited.Schedule.Credentials = &Credentials{}
	if ScheduleRevision(edited.Schedule) ==
		ScheduleRevision(Schedule{
			Cron:      edited.Schedule.Cron,
			Enabled:   edited.Schedule.Enabled,
			CreatedBy: edited.Schedule.CreatedBy,
			Timezone:  edited.Schedule.Timezone,
		}) {
		t.Fatal("credentials object and absent credentials collided")
	}
}

func TestValidCandidateRejectsAnotherUsersPersonalScope(t *testing.T) {
	candidate := dueCandidate(7, 9, "docs")
	candidate.ScheduleUserID = 12
	candidate.Schedule.CreatedBy = 11
	if validCandidate(candidate) {
		t.Fatal("candidate selected another user's private scope")
	}
	candidate.ScheduleUserID = 11
	if !validCandidate(candidate) {
		t.Fatal("candidate rejected its creator's personal scope")
	}
}

const sha256HexBytes = 64

func dueCandidate(projectID, toolkitID int64, index string) Candidate {
	return Candidate{
		ProjectID: projectID, ToolkitID: toolkitID, ToolkitType: "github",
		IndexMetaID: index, ScheduleUserID: -1,
		Schedule: Schedule{
			Cron: "0 3 * * *", Enabled: true, CreatedBy: 11,
			Timezone: "UTC", LastRun: "2026-07-27T03:00:00+00:00",
		},
	}
}
