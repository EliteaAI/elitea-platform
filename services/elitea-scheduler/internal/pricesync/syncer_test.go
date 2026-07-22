package pricesync

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
)

// --- fakes -------------------------------------------------------------------

// fakeSource returns a fixed set of raws (or an error) in a declared denomination.
type fakeSource struct {
	name  string
	denom Denomination
	raws  []RawModelPrice
	err   error
}

func (f *fakeSource) Name() string                                   { return f.name }
func (f *fakeSource) Denomination() Denomination                     { return f.denom }
func (f *fakeSource) Fetch(context.Context) ([]RawModelPrice, error) { return f.raws, f.err }

// fakeRow returns a preset bool for the advisory-lock probe scan.
type fakeRow struct {
	locked  bool
	scanErr error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	if len(dest) == 1 {
		if p, ok := dest[0].(*bool); ok {
			*p = r.locked
		}
	}
	return nil
}

// fakeTx records the args of every Exec (the UPSERT calls) for assertions.
type fakeTx struct {
	locked     bool
	scanErr    error
	execErr    error
	commitErr  error
	execArgs   [][]any
	committed  bool
	rolledBack bool
}

func (t *fakeTx) QueryRow(_ context.Context, _ string, _ ...any) Row {
	return fakeRow{locked: t.locked, scanErr: t.scanErr}
}
func (t *fakeTx) Exec(_ context.Context, _ string, args ...any) error {
	if t.execErr != nil {
		return t.execErr
	}
	t.execArgs = append(t.execArgs, args)
	return nil
}
func (t *fakeTx) Commit(context.Context) error   { t.committed = true; return t.commitErr }
func (t *fakeTx) Rollback(context.Context) error { t.rolledBack = true; return nil }

type fakeDB struct {
	tx       *fakeTx
	beginErr error
}

func (d *fakeDB) Begin(context.Context) (Tx, error) {
	if d.beginErr != nil {
		return nil, d.beginErr
	}
	return d.tx, nil
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// --- tests -------------------------------------------------------------------

func TestSyncUpsertsAndCommits(t *testing.T) {
	src := &fakeSource{
		name:  "litellm",
		denom: PerToken,
		raws: []RawModelPrice{
			{Provider: "openai", ModelName: "gpt-4o", InputCost: fptr(0.0000025), OutputCost: fptr(0.00001)},
		},
	}
	tx := &fakeTx{locked: true}
	db := &fakeDB{tx: tx}
	s := NewSyncer(db, []PriceSource{src}, quietLogger())

	n, err := s.Sync(context.Background())
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if n != 1 {
		t.Fatalf("upserted = %d, want 1", n)
	}
	if !tx.committed {
		t.Error("expected commit")
	}
	if len(tx.execArgs) != 1 {
		t.Fatalf("expected 1 upsert, got %d", len(tx.execArgs))
	}
	// arg order: provider, model, input1m, output1m, cacheCreate, cacheRead, above128k, source
	args := tx.execArgs[0]
	if args[0] != "openai" || args[1] != "gpt-4o" {
		t.Errorf("bad key args: %v %v", args[0], args[1])
	}
	in, ok := args[2].(*float64)
	if !ok || in == nil || !almost(*in, 2.50) {
		t.Errorf("input per-1M arg = %v, want 2.50", args[2])
	}
	out, ok := args[3].(*float64)
	if !ok || out == nil || !almost(*out, 10.00) {
		t.Errorf("output per-1M arg = %v, want 10.00", args[3])
	}
	if args[7] != "litellm" {
		t.Errorf("source arg = %v, want litellm", args[7])
	}
}

func TestSyncAdvisoryLockHeldIsNoOp(t *testing.T) {
	src := &fakeSource{name: "seed", denom: Per1M, raws: []RawModelPrice{{Provider: "openai", ModelName: "gpt-4o", InputCost: fptr(2.5)}}}
	tx := &fakeTx{locked: false} // another replica holds the lock
	db := &fakeDB{tx: tx}
	s := NewSyncer(db, []PriceSource{src}, quietLogger())

	n, err := s.Sync(context.Background())
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if n != 0 {
		t.Errorf("lock-held pass must upsert 0, got %d", n)
	}
	if len(tx.execArgs) != 0 {
		t.Error("must not upsert when lock is held")
	}
	if tx.committed {
		t.Error("must not commit when lock is held")
	}
}

func TestSyncFirstSourceWins(t *testing.T) {
	// litellm (per-token) and seed (per-1M) both define gpt-4o; litellm precedes.
	litellm := &fakeSource{name: "litellm", denom: PerToken, raws: []RawModelPrice{
		{Provider: "openai", ModelName: "gpt-4o", InputCost: fptr(0.0000025)}, // → 2.50
	}}
	seed := &fakeSource{name: "seed", denom: Per1M, raws: []RawModelPrice{
		{Provider: "openai", ModelName: "gpt-4o", InputCost: fptr(2.60)},    // ignored (later)
		{Provider: "anthropic", ModelName: "claude", InputCost: fptr(3.00)}, // gap fill
	}}
	tx := &fakeTx{locked: true}
	s := NewSyncer(&fakeDB{tx: tx}, []PriceSource{litellm, seed}, quietLogger())

	n, err := s.Sync(context.Background())
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if n != 2 {
		t.Fatalf("want 2 merged models, got %d", n)
	}
	// Find gpt-4o's upserted input price: must be the litellm-derived 2.50.
	for _, args := range tx.execArgs {
		if args[1] == "gpt-4o" {
			in := args[2].(*float64)
			if !almost(*in, 2.50) {
				t.Errorf("first-source-wins broken: gpt-4o input = %v, want 2.50", *in)
			}
		}
	}
}

func TestSyncFailOpenOnSourceError(t *testing.T) {
	bad := &fakeSource{name: "litellm", denom: PerToken, err: errors.New("network down")}
	good := &fakeSource{name: "seed", denom: Per1M, raws: []RawModelPrice{
		{Provider: "openai", ModelName: "gpt-4o", InputCost: fptr(2.5)},
	}}
	tx := &fakeTx{locked: true}
	s := NewSyncer(&fakeDB{tx: tx}, []PriceSource{bad, good}, quietLogger())

	n, err := s.Sync(context.Background())
	if err != nil {
		t.Fatalf("one bad source must not fail the pass: %v", err)
	}
	if n != 1 {
		t.Errorf("want 1 model from surviving source, got %d", n)
	}
}

func TestSyncAllSourcesFail(t *testing.T) {
	a := &fakeSource{name: "litellm", denom: PerToken, err: errors.New("down")}
	b := &fakeSource{name: "seed", denom: Per1M, err: errors.New("down")}
	s := NewSyncer(&fakeDB{tx: &fakeTx{locked: true}}, []PriceSource{a, b}, quietLogger())

	if _, err := s.Sync(context.Background()); err == nil {
		t.Fatal("all-sources-fail must return an error")
	}
}

func TestSyncNoSourcesConfigured(t *testing.T) {
	s := NewSyncer(&fakeDB{tx: &fakeTx{locked: true}}, nil, quietLogger())
	if _, err := s.Sync(context.Background()); err == nil {
		t.Fatal("no sources must return an error")
	}
}

func TestSyncEmptyMergeSkipsUpsert(t *testing.T) {
	// A source that succeeds but yields zero rows → nothing to upsert, no error.
	empty := &fakeSource{name: "seed", denom: Per1M, raws: nil}
	tx := &fakeTx{locked: true}
	s := NewSyncer(&fakeDB{tx: tx}, []PriceSource{empty}, quietLogger())

	n, err := s.Sync(context.Background())
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if n != 0 || len(tx.execArgs) != 0 {
		t.Errorf("empty merge must skip upsert, got n=%d execs=%d", n, len(tx.execArgs))
	}
}

func TestSyncBeginError(t *testing.T) {
	src := &fakeSource{name: "seed", denom: Per1M, raws: []RawModelPrice{{Provider: "p", ModelName: "m", InputCost: fptr(1)}}}
	s := NewSyncer(&fakeDB{beginErr: errors.New("no conn")}, []PriceSource{src}, quietLogger())
	if _, err := s.Sync(context.Background()); err == nil {
		t.Fatal("begin error must propagate")
	}
}

func TestSyncScanError(t *testing.T) {
	src := &fakeSource{name: "seed", denom: Per1M, raws: []RawModelPrice{{Provider: "p", ModelName: "m", InputCost: fptr(1)}}}
	tx := &fakeTx{scanErr: errors.New("scan boom")}
	s := NewSyncer(&fakeDB{tx: tx}, []PriceSource{src}, quietLogger())
	if _, err := s.Sync(context.Background()); err == nil {
		t.Fatal("scan error must propagate")
	}
}

func TestSyncExecError(t *testing.T) {
	src := &fakeSource{name: "seed", denom: Per1M, raws: []RawModelPrice{{Provider: "p", ModelName: "m", InputCost: fptr(1)}}}
	tx := &fakeTx{locked: true, execErr: errors.New("exec boom")}
	s := NewSyncer(&fakeDB{tx: tx}, []PriceSource{src}, quietLogger())
	if _, err := s.Sync(context.Background()); err == nil {
		t.Fatal("exec error must propagate")
	}
}

func TestSyncCommitError(t *testing.T) {
	src := &fakeSource{name: "seed", denom: Per1M, raws: []RawModelPrice{{Provider: "p", ModelName: "m", InputCost: fptr(1)}}}
	tx := &fakeTx{locked: true, commitErr: errors.New("commit boom")}
	s := NewSyncer(&fakeDB{tx: tx}, []PriceSource{src}, quietLogger())
	if _, err := s.Sync(context.Background()); err == nil {
		t.Fatal("commit error must propagate")
	}
}

func TestSyncBadDenominationSkipsModel(t *testing.T) {
	// An invalid denomination must skip the model (normalize error), not crash.
	bad := &fakeSource{name: "x", denom: DenominationUnknown, raws: []RawModelPrice{{Provider: "p", ModelName: "m", InputCost: fptr(1)}}}
	tx := &fakeTx{locked: true}
	s := NewSyncer(&fakeDB{tx: tx}, []PriceSource{bad}, quietLogger())
	n, err := s.Sync(context.Background())
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	// Source succeeded (fetch ok) but its only model failed to normalize → 0 rows.
	if n != 0 {
		t.Errorf("bad-denomination model must be skipped, got n=%d", n)
	}
}

func TestPriceDrifts(t *testing.T) {
	cases := []struct {
		a, b float64
		want bool
	}{
		{2.50, 2.50, false}, // equal
		{2.50, 2.60, false}, // 4% < 10%
		{2.50, 3.00, true},  // 20% > 10%
		{0, 0, false},       // both zero
		{0, 1, true},        // zero vs nonzero
		{2.50, 2.75, false}, // exactly 10% (not strictly greater)
	}
	for _, c := range cases {
		if got := priceDrifts(c.a, c.b); got != c.want {
			t.Errorf("priceDrifts(%v,%v) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

func TestNewSyncerNilLogger(t *testing.T) {
	s := NewSyncer(&fakeDB{tx: &fakeTx{}}, nil, nil)
	if s.logger == nil {
		t.Error("nil logger must fall back to default")
	}
}
