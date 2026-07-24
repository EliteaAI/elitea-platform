package failmode

import (
	"sync"
	"testing"
)

func TestDegradedCounters_AddGetReset(t *testing.T) {
	d := NewDegradedCounters()

	if got := d.Get("missing"); got != 0 {
		t.Fatalf("unseen key = %d, want 0", got)
	}

	if got := d.Add("a", 5); got != 5 {
		t.Fatalf("Add returned %d, want 5", got)
	}
	if got := d.Add("a", 3); got != 8 {
		t.Fatalf("Add accumulate = %d, want 8", got)
	}
	if got := d.Get("a"); got != 8 {
		t.Fatalf("Get = %d, want 8", got)
	}

	// A second key is independent.
	d.Add("b", 100)
	if d.Get("a") != 8 || d.Get("b") != 100 {
		t.Fatalf("keys not independent: a=%d b=%d", d.Get("a"), d.Get("b"))
	}

	d.Reset("a")
	if d.Get("a") != 0 {
		t.Fatalf("Reset(a) left %d", d.Get("a"))
	}
	if d.Get("b") != 100 {
		t.Fatalf("Reset(a) touched b: %d", d.Get("b"))
	}
	// Reset of an unseen key is a no-op (must not panic).
	d.Reset("never")
}

func TestDegradedCounters_NegativeDelta(t *testing.T) {
	d := NewDegradedCounters()
	d.Add("a", 10)
	if got := d.Add("a", -4); got != 6 {
		t.Fatalf("negative delta = %d, want 6", got)
	}
}

func TestDegradedCounters_ResetAll(t *testing.T) {
	d := NewDegradedCounters()
	d.Add("a", 1)
	d.Add("b", 2)
	d.Add("c", 3)
	d.ResetAll()
	for _, k := range []string{"a", "b", "c"} {
		if d.Get(k) != 0 {
			t.Fatalf("ResetAll left %s=%d", k, d.Get(k))
		}
	}
}

func TestDegradedCounters_ConcurrentAdd(t *testing.T) {
	d := NewDegradedCounters()
	const goroutines, perG = 50, 200
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < perG; j++ {
				d.Add("hot", 1)
			}
		}()
	}
	wg.Wait()
	if got := d.Get("hot"); got != goroutines*perG {
		t.Fatalf("concurrent Add lost updates: %d, want %d", got, goroutines*perG)
	}
}
