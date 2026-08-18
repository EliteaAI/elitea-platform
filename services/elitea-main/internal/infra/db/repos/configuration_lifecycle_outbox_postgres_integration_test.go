package repos

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCurrentConfigurationLifecycleOutboxPostgresOrdersAndBlocksRevisions(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repository := mustCurrentConfigurationLifecyclePostgresRepository(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	now := currentConfigurationLifecyclePostgresClock(t, ctx, pool)

	configurationA := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	configurationB := "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	configurationC := "cccccccc-cccc-cccc-cccc-cccccccccccc"
	configurationD := "dddddddd-dddd-dddd-dddd-dddddddddddd"
	configurationE := "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
	configurationF := "ffffffff-ffff-ffff-ffff-ffffffffffff"
	a1 := currentConfigurationLifecyclePostgresFixture{
		eventID: "11111111-1111-4111-8111-111111111111", configurationUUID: configurationA,
		revision: 1, state: "PENDING", availableAt: now.Add(-20 * time.Minute), createdAt: now.Add(-30 * time.Minute),
	}
	a2 := currentConfigurationLifecyclePostgresFixture{
		eventID: "11111111-1111-4111-8111-111111111112", configurationUUID: configurationA,
		revision: 2, state: "PENDING", availableAt: now.Add(-40 * time.Minute), createdAt: now.Add(-40 * time.Minute),
	}
	b1 := currentConfigurationLifecyclePostgresFixture{
		eventID: "22222222-2222-4222-8222-222222222221", configurationUUID: configurationB,
		revision: 1, state: "PENDING", availableAt: now.Add(-10 * time.Minute), createdAt: now.Add(-20 * time.Minute),
	}
	for _, fixture := range []currentConfigurationLifecyclePostgresFixture{
		a1,
		a2,
		b1,
		{
			eventID: "33333333-3333-4333-8333-333333333331", configurationUUID: configurationC,
			revision: 1, state: "DEAD", attemptCount: 1, availableAt: now.Add(-time.Hour),
			createdAt: now.Add(-2 * time.Hour), lastAttemptAt: currentLifecycleTime(now.Add(-90 * time.Minute)),
			deadAt: currentLifecycleTime(now.Add(-80 * time.Minute)), errorCode: currentLifecycleString("SNAPSHOT_INVALID"),
		},
		{
			eventID: "33333333-3333-4333-8333-333333333332", configurationUUID: configurationC,
			revision: 2, state: "PENDING", availableAt: now.Add(-50 * time.Minute), createdAt: now.Add(-50 * time.Minute),
		},
		{
			eventID: "44444444-4444-4444-8444-444444444441", configurationUUID: configurationD,
			revision: 1, state: "RETRY", attemptCount: 1, availableAt: now.Add(time.Hour),
			createdAt: now.Add(-time.Hour), lastAttemptAt: currentLifecycleTime(now.Add(-30 * time.Minute)),
			errorCode: currentLifecycleString("DEPENDENCY_UNAVAILABLE"),
		},
		{
			eventID: "44444444-4444-4444-8444-444444444442", configurationUUID: configurationD,
			revision: 2, state: "PENDING", availableAt: now.Add(-time.Hour), createdAt: now.Add(-time.Hour),
		},
		{
			eventID: "55555555-5555-4555-8555-555555555551", configurationUUID: configurationE,
			revision: 1, state: "PROCESSING", attemptCount: 1, availableAt: now.Add(-time.Hour),
			createdAt: now.Add(-time.Hour), lastAttemptAt: currentLifecycleTime(now.Add(-time.Minute)),
			leaseOwner: currentLifecycleString("active-lease"), leaseExpiresAt: currentLifecycleTime(now.Add(time.Minute)),
		},
		{
			eventID: "55555555-5555-4555-8555-555555555552", configurationUUID: configurationE,
			revision: 2, state: "PENDING", availableAt: now.Add(-2 * time.Hour), createdAt: now.Add(-2 * time.Hour),
		},
		{
			eventID: "99999999-9999-4999-8999-999999999991", configurationUUID: configurationF,
			revision: 1, state: "PROCESSING", attemptCount: 1000, availableAt: now.Add(-3 * time.Hour),
			createdAt: now.Add(-3 * time.Hour), lastAttemptAt: currentLifecycleTime(now.Add(-2 * time.Minute)),
			leaseOwner: currentLifecycleString("exhausted-lease"), leaseExpiresAt: currentLifecycleTime(now.Add(-time.Minute)),
		},
		{
			eventID: "99999999-9999-4999-8999-999999999992", configurationUUID: configurationF,
			revision: 2, state: "PENDING", availableAt: now.Add(-4 * time.Hour), createdAt: now.Add(-4 * time.Hour),
		},
	} {
		seedCurrentConfigurationLifecyclePostgres(t, ctx, pool, fixture)
	}

	events, err := repository.ClaimCurrentConfigurationLifecycle(ctx, "order-lease-1", 2, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].EventID != a1.eventID || events[1].EventID != b1.eventID {
		t.Fatalf("ordered events=%#v", events)
	}
	if events[0].AttemptCount != 1 || events[1].AttemptCount != 1 ||
		events[0].LeaseToken != "order-lease-1" || events[1].LeaseToken != "order-lease-1" {
		t.Fatalf("claim bindings=%#v", events)
	}
	wantSnapshot, wantDigest := currentConfigurationLifecyclePostgresPayload(a1.eventID)
	if !bytes.Equal(events[0].Snapshot, wantSnapshot) || events[0].SnapshotDigest != wantDigest {
		t.Fatalf("snapshot=%q digest=%x", events[0].Snapshot, events[0].SnapshotDigest)
	}
	var (
		exhaustedState  string
		exhaustedOwner  *string
		exhaustedExpiry *time.Time
		exhaustedDeadAt *time.Time
		exhaustedCode   *string
	)
	if err := pool.QueryRow(ctx, `
SELECT state, lease_owner, lease_expires_at, dead_at, last_error_code
FROM elitea_runtime.configuration_lifecycle_outbox
WHERE event_id = '99999999-9999-4999-8999-999999999991'`).Scan(
		&exhaustedState, &exhaustedOwner, &exhaustedExpiry, &exhaustedDeadAt, &exhaustedCode,
	); err != nil {
		t.Fatal(err)
	}
	if exhaustedState != "DEAD" || exhaustedOwner != nil || exhaustedExpiry != nil ||
		exhaustedDeadAt == nil || exhaustedCode == nil || *exhaustedCode != "ATTEMPTS_EXHAUSTED" {
		t.Fatalf(
			"exhausted state=%q owner=%v expiry=%v dead=%v code=%v",
			exhaustedState, exhaustedOwner, exhaustedExpiry, exhaustedDeadAt, exhaustedCode,
		)
	}

	blocked, err := repository.ClaimCurrentConfigurationLifecycle(ctx, "order-lease-2", 10, time.Minute)
	if err != nil || len(blocked) != 0 {
		t.Fatalf("blocked claim=%#v err=%v", blocked, err)
	}
	if err := repository.MarkCurrentConfigurationLifecycleDelivered(ctx, a1.eventID, "order-lease-1"); err != nil {
		t.Fatal(err)
	}
	if err := repository.MarkCurrentConfigurationLifecycleDelivered(ctx, b1.eventID, "order-lease-1"); err != nil {
		t.Fatal(err)
	}

	unblocked, err := repository.ClaimCurrentConfigurationLifecycle(ctx, "order-lease-3", 10, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if len(unblocked) != 1 || unblocked[0].EventID != a2.eventID || unblocked[0].Revision != 2 {
		t.Fatalf("unblocked events=%#v", unblocked)
	}
}

func TestCurrentConfigurationLifecycleOutboxPostgresReclaimsAndFencesTransitions(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repository := mustCurrentConfigurationLifecyclePostgresRepository(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	now := currentConfigurationLifecyclePostgresClock(t, ctx, pool)
	fixture := currentConfigurationLifecyclePostgresFixture{
		eventID: "66666666-6666-4666-8666-666666666661", configurationUUID: "ffffffff-ffff-ffff-ffff-ffffffffffff",
		revision: 1, state: "PROCESSING", attemptCount: 3, availableAt: now.Add(-time.Hour),
		createdAt: now.Add(-2 * time.Hour), lastAttemptAt: currentLifecycleTime(now.Add(-2 * time.Minute)),
		leaseOwner: currentLifecycleString("expired-lease"), leaseExpiresAt: currentLifecycleTime(now.Add(-time.Minute)),
	}
	seedCurrentConfigurationLifecyclePostgres(t, ctx, pool, fixture)

	events, err := repository.ClaimCurrentConfigurationLifecycle(ctx, "reclaim-lease-1", 1, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].EventID != fixture.eventID || events[0].AttemptCount != 4 ||
		events[0].LeaseToken != "reclaim-lease-1" {
		t.Fatalf("reclaimed events=%#v", events)
	}
	if err := repository.MarkCurrentConfigurationLifecycleDelivered(
		ctx, fixture.eventID, "expired-lease",
	); !errors.Is(err, ErrCurrentConfigurationLifecycleLeaseLost) {
		t.Fatalf("stale lease error=%v", err)
	}

	beforeRetry := currentConfigurationLifecyclePostgresClock(t, ctx, pool)
	if err := repository.MarkCurrentConfigurationLifecycleRetry(
		ctx, fixture.eventID, "reclaim-lease-1", "DEPENDENCY_UNAVAILABLE", 2*time.Second,
	); err != nil {
		t.Fatal(err)
	}
	afterRetry := currentConfigurationLifecyclePostgresClock(t, ctx, pool)
	var (
		state       string
		availableAt time.Time
		leaseOwner  *string
		leaseExpiry *time.Time
		errorCode   *string
	)
	if err := pool.QueryRow(ctx, `
SELECT state, available_at, lease_owner, lease_expires_at, last_error_code
FROM elitea_runtime.configuration_lifecycle_outbox
WHERE event_id = $1`, fixture.eventID).Scan(
		&state, &availableAt, &leaseOwner, &leaseExpiry, &errorCode,
	); err != nil {
		t.Fatal(err)
	}
	if state != "RETRY" || leaseOwner != nil || leaseExpiry != nil || errorCode == nil ||
		*errorCode != "DEPENDENCY_UNAVAILABLE" || availableAt.Before(beforeRetry.Add(2*time.Second)) ||
		availableAt.After(afterRetry.Add(2*time.Second)) {
		t.Fatalf("retry state=%q available=%s lease=%v/%v error=%v", state, availableAt, leaseOwner, leaseExpiry, errorCode)
	}
	if events, err := repository.ClaimCurrentConfigurationLifecycle(
		ctx, "reclaim-lease-2", 1, time.Minute,
	); err != nil || len(events) != 0 {
		t.Fatalf("early retry claim=%#v err=%v", events, err)
	}

	if _, err := pool.Exec(ctx, `
UPDATE elitea_runtime.configuration_lifecycle_outbox
SET available_at = clock_timestamp() - interval '1 second'
WHERE event_id = $1`, fixture.eventID); err != nil {
		t.Fatal(err)
	}
	events, err = repository.ClaimCurrentConfigurationLifecycle(ctx, "reclaim-lease-3", 1, time.Minute)
	if err != nil || len(events) != 1 || events[0].AttemptCount != 5 {
		t.Fatalf("retry reclaim=%#v err=%v", events, err)
	}
	if _, err := pool.Exec(ctx, `
UPDATE elitea_runtime.configuration_lifecycle_outbox
SET last_attempt_at = clock_timestamp() - interval '2 seconds',
    lease_expires_at = clock_timestamp() - interval '1 second',
    updated_at = clock_timestamp()
WHERE event_id = $1`, fixture.eventID); err != nil {
		t.Fatal(err)
	}
	if err := repository.MarkCurrentConfigurationLifecycleDead(
		ctx, fixture.eventID, "reclaim-lease-3", "RETRY_EXHAUSTED",
	); !errors.Is(err, ErrCurrentConfigurationLifecycleLeaseLost) {
		t.Fatalf("expired transition error=%v", err)
	}
	events, err = repository.ClaimCurrentConfigurationLifecycle(ctx, "reclaim-lease-4", 1, time.Minute)
	if err != nil || len(events) != 1 || events[0].AttemptCount != 6 {
		t.Fatalf("expired reclaim=%#v err=%v", events, err)
	}
	if err := repository.MarkCurrentConfigurationLifecycleDead(
		ctx, fixture.eventID, "reclaim-lease-4", "RETRY_EXHAUSTED",
	); err != nil {
		t.Fatal(err)
	}
	if err := repository.MarkCurrentConfigurationLifecycleDead(
		ctx, fixture.eventID, "reclaim-lease-4", "RETRY_EXHAUSTED",
	); !errors.Is(err, ErrCurrentConfigurationLifecycleLeaseLost) {
		t.Fatalf("double transition error=%v", err)
	}
}

func TestCurrentConfigurationLifecycleOutboxPostgresSkipsLocksAndClaimsConcurrently(t *testing.T) {
	pool := newMigratedPostgresIntegrationPool(t)
	repository := mustCurrentConfigurationLifecyclePostgresRepository(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	now := currentConfigurationLifecyclePostgresClock(t, ctx, pool)
	locked := currentConfigurationLifecyclePostgresFixture{
		eventID: "77777777-7777-4777-8777-777777777771", configurationUUID: "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		revision: 1, state: "PENDING", availableAt: now.Add(-2 * time.Minute), createdAt: now.Add(-2 * time.Minute),
	}
	skippable := currentConfigurationLifecyclePostgresFixture{
		eventID: "77777777-7777-4777-8777-777777777772", configurationUUID: "22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		revision: 1, state: "PENDING", availableAt: now.Add(-time.Minute), createdAt: now.Add(-time.Minute),
	}
	seedCurrentConfigurationLifecyclePostgres(t, ctx, pool, locked)
	seedCurrentConfigurationLifecyclePostgres(t, ctx, pool, skippable)

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var lockedID string
	if err := tx.QueryRow(ctx, `
SELECT event_id::text
FROM elitea_runtime.configuration_lifecycle_outbox
WHERE event_id = $1
FOR UPDATE`, locked.eventID).Scan(&lockedID); err != nil || lockedID != locked.eventID {
		t.Fatalf("lock event=%q err=%v", lockedID, err)
	}

	claimCtx, claimCancel := context.WithTimeout(ctx, 3*time.Second)
	events, err := repository.ClaimCurrentConfigurationLifecycle(claimCtx, "skip-lease", 1, time.Minute)
	claimCancel()
	if err != nil || len(events) != 1 || events[0].EventID != skippable.eventID {
		t.Fatalf("skip-locked events=%#v err=%v", events, err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err := repository.MarkCurrentConfigurationLifecycleDelivered(
		ctx, skippable.eventID, "skip-lease",
	); err != nil {
		t.Fatal(err)
	}
	events, err = repository.ClaimCurrentConfigurationLifecycle(ctx, "released-lease", 1, time.Minute)
	if err != nil || len(events) != 1 || events[0].EventID != locked.eventID {
		t.Fatalf("released events=%#v err=%v", events, err)
	}
	if err := repository.MarkCurrentConfigurationLifecycleDelivered(
		ctx, locked.eventID, "released-lease",
	); err != nil {
		t.Fatal(err)
	}

	concurrentIDs := []string{
		"88888888-8888-4888-8888-888888888881",
		"88888888-8888-4888-8888-888888888882",
		"88888888-8888-4888-8888-888888888883",
		"88888888-8888-4888-8888-888888888884",
	}
	for index, eventID := range concurrentIDs {
		seedCurrentConfigurationLifecyclePostgres(t, ctx, pool, currentConfigurationLifecyclePostgresFixture{
			eventID: eventID, configurationUUID: eventID,
			revision: 1, state: "PENDING", availableAt: now.Add(-time.Minute + time.Duration(index)*time.Millisecond), createdAt: now.Add(-time.Minute),
		})
	}
	type claimResult struct {
		events []string
		err    error
	}
	start := make(chan struct{})
	results := make(chan claimResult, 2)
	var workers sync.WaitGroup
	for index := 1; index <= 2; index++ {
		leaseToken := "concurrent-lease-" + string(rune('0'+index))
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			claimed, claimErr := repository.ClaimCurrentConfigurationLifecycle(
				ctx, leaseToken, 2, time.Minute,
			)
			ids := make([]string, len(claimed))
			for eventIndex := range claimed {
				ids[eventIndex] = claimed[eventIndex].EventID
			}
			results <- claimResult{events: ids, err: claimErr}
		}()
	}
	close(start)
	workers.Wait()
	close(results)
	var claimedIDs []string
	for result := range results {
		if result.err != nil || len(result.events) != 2 {
			t.Fatalf("concurrent claim=%#v err=%v", result.events, result.err)
		}
		claimedIDs = append(claimedIDs, result.events...)
	}
	sort.Strings(claimedIDs)
	if !equalCurrentLifecycleStrings(claimedIDs, concurrentIDs) {
		t.Fatalf("concurrent claimed IDs=%v", claimedIDs)
	}
}

type currentConfigurationLifecyclePostgresFixture struct {
	eventID           string
	configurationUUID string
	revision          int64
	state             string
	attemptCount      int32
	availableAt       time.Time
	createdAt         time.Time
	lastAttemptAt     *time.Time
	leaseOwner        *string
	leaseExpiresAt    *time.Time
	deadAt            *time.Time
	errorCode         *string
}

func seedCurrentConfigurationLifecyclePostgres(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	fixture currentConfigurationLifecyclePostgresFixture,
) {
	t.Helper()
	snapshot, digest := currentConfigurationLifecyclePostgresPayload(fixture.eventID)
	if _, err := pool.Exec(ctx, `
INSERT INTO elitea_runtime.configuration_lifecycle_outbox (
    event_id, resource_project_id, configuration_uuid, revision, operation,
    actor_id, sanitized_snapshot, snapshot_digest, state, attempt_count,
    available_at, last_attempt_at, lease_owner, lease_expires_at, dead_at,
    last_error_code, created_at, updated_at
) VALUES (
    $1, 1, $2, $3, 'configuration_updated', 42, $4::json, $5, $6, $7,
    $8, $9, $10, $11, $12, $13, $14, $15
)`,
		fixture.eventID,
		fixture.configurationUUID,
		fixture.revision,
		snapshot,
		digest[:],
		fixture.state,
		fixture.attemptCount,
		fixture.availableAt,
		fixture.lastAttemptAt,
		fixture.leaseOwner,
		fixture.leaseExpiresAt,
		fixture.deadAt,
		fixture.errorCode,
		fixture.createdAt,
		fixture.createdAt,
	); err != nil {
		t.Fatalf("seed lifecycle event %s: %v", fixture.eventID, err)
	}
}

func currentConfigurationLifecyclePostgresPayload(eventID string) ([]byte, [32]byte) {
	snapshot := []byte(`{ "event_id": "` + eventID + `", "settings": {} }`)
	return snapshot, sha256.Sum256(snapshot)
}

func mustCurrentConfigurationLifecyclePostgresRepository(
	t *testing.T,
	pool *pgxpool.Pool,
) *CurrentConfigurationLifecycleOutboxRepository {
	t.Helper()
	repository, err := NewCurrentConfigurationLifecycleOutboxRepository(pool)
	if err != nil {
		t.Fatal(err)
	}
	return repository
}

func currentConfigurationLifecyclePostgresClock(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
) time.Time {
	t.Helper()
	var now time.Time
	if err := pool.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		t.Fatal(err)
	}
	return now
}

func currentLifecycleTime(value time.Time) *time.Time {
	return &value
}

func currentLifecycleString(value string) *string {
	return &value
}

func equalCurrentLifecycleStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
