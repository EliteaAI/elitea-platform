package repos

// checkRelations, and the one thing it must never do.
//
// It used to swallow the error from its `to_regclass` probe and answer `false`,
// which made a transient database failure — an expired deadline, a reset
// connection — indistinguishable from a table that genuinely is not there. The
// callers turn "not there" into a figure this deployment cannot produce, so the
// Users tab would answer 200 with every email blank: "User 41" for each row,
// no error anywhere, nothing to retry.
//
// That is this endpoint's own defect inverted. It answers 501 rather than 500
// for an absent producer so a permanent gap is not read as a fault; the
// distinction has to hold in the other direction too.
//
// This is an INTERNAL test rather than an integration one on purpose. The
// integration attempt could not discriminate: breaking the database breaks the
// query that runs BEFORE the probe, so the read fails either way and the test
// passed with the fix reverted. Only a stub can fail the probe alone.

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

// probeStub is an analyticsQuerier whose QueryRow always fails, standing in for
// a connection that dropped between statements. It is its own pgx.Row too — one
// type rather than two identically-shaped ones, which staticcheck rightly reads
// as a missing conversion (S1016).
type probeStub struct{ err error }

func (s probeStub) Query(context.Context, string, ...any) (pgx.Rows, error) {
	panic("checkRelations must not call Query")
}

func (s probeStub) QueryRow(context.Context, string, ...any) pgx.Row { return s }

func (s probeStub) Scan(...any) error { return s.err }

func TestCheckRelationsReportsAProbeFailureInsteadOfAnswerFalse(t *testing.T) {
	t.Parallel()

	dropped := errors.New("connection reset by peer")
	present, err := checkRelations(context.Background(), probeStub{err: dropped}, "public.auth_core__user")

	if err == nil {
		t.Fatal("a failed probe answered without an error — a dropped connection is now " +
			"indistinguishable from a missing table, and the caller will report the feature as absent")
	}
	if !errors.Is(err, dropped) {
		t.Errorf("error does not wrap the cause: %v", err)
	}
	if present {
		t.Error("a failed probe must not claim the relations are present")
	}
}

// The callers must PROPAGATE it rather than degrade. userIdentities returning
// an empty map here is what turns the failure into a silently email-less list.
func TestUserIdentitiesPropagatesAProbeFailure(t *testing.T) {
	t.Parallel()

	dropped := errors.New("connection reset by peer")
	identities, err := userIdentities(context.Background(), probeStub{err: dropped}, []int64{7})

	if err == nil {
		t.Fatalf("userIdentities swallowed a probe failure and returned %v — every row would "+
			"render without its email, on a 200, with nothing reporting a fault", identities)
	}
	if !errors.Is(err, dropped) {
		t.Errorf("error does not wrap the cause: %v", err)
	}
}
