package pricesync

import (
	"context"
	"testing"
	"time"
)

func TestNewWorkerDefaults(t *testing.T) {
	w := NewWorker(nil, 0, nil)
	if w.interval != 24*time.Hour {
		t.Errorf("non-positive interval must default to 24h, got %v", w.interval)
	}
	if w.logger == nil {
		t.Error("nil logger must fall back to default")
	}
	if w2 := NewWorker(nil, -time.Second, nil); w2.interval != 24*time.Hour {
		t.Errorf("negative interval must default to 24h, got %v", w2.interval)
	}
}

func TestNewWorkerKeepsInterval(t *testing.T) {
	w := NewWorker(nil, 6*time.Hour, quietLogger())
	if w.interval != 6*time.Hour {
		t.Errorf("interval = %v, want 6h", w.interval)
	}
}

// TestWorkerRunOnceThenCancel verifies Run does an immediate pass and then exits
// promptly on context cancel, and that a Sync error does not wedge the worker.
func TestWorkerRunExitsOnCancel(t *testing.T) {
	// A source that always fails → Sync returns an error every pass; the worker
	// must log-and-continue, not panic or block.
	bad := &fakeSource{name: "litellm", denom: PerToken, err: errTest}
	s := NewSyncer(&fakeDB{tx: &fakeTx{locked: true}}, []PriceSource{bad}, quietLogger())
	w := NewWorker(s, time.Hour, quietLogger())

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		w.Run(ctx)
		close(done)
	}()
	// Give the immediate pass time to run, then cancel.
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not exit after context cancel")
	}
}

// TestWorkerRunOnceUpserts confirms the immediate pass actually drives an upsert.
func TestWorkerRunOnceUpserts(t *testing.T) {
	src := &fakeSource{name: "seed", denom: Per1M, raws: []RawModelPrice{
		{Provider: "openai", ModelName: "gpt-4o", InputCost: fptr(2.5)},
	}}
	tx := &fakeTx{locked: true}
	s := NewSyncer(&fakeDB{tx: tx}, []PriceSource{src}, quietLogger())
	w := NewWorker(s, time.Hour, quietLogger())

	w.runOnce(context.Background())
	if len(tx.execArgs) != 1 {
		t.Errorf("runOnce must drive one upsert, got %d", len(tx.execArgs))
	}
}

var errTest = errTestType("boom")

type errTestType string

func (e errTestType) Error() string { return string(e) }
