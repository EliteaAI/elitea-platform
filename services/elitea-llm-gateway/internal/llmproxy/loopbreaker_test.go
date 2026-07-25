package llmproxy

import (
	"testing"
	"time"
)

// testClock is an injectable manual clock for loopBreaker tests.
type testClock struct{ t time.Time }

func (c *testClock) now() time.Time          { return c.t }
func (c *testClock) advance(d time.Duration) { c.t = c.t.Add(d) }
func newTestBreaker() (*loopBreaker, *testClock) {
	clk := &testClock{t: time.Unix(1_700_000_000, 0)}
	b := newLoopBreaker()
	b.now = clk.now
	return b, clk
}

// TestLoopBreaker_TripsAtThreshold asserts the spec §2.6 numbers exactly:
// 4 requests in 1 s are allowed, the 5th trips the circuit.
func TestLoopBreaker_TripsAtThreshold(t *testing.T) {
	b, clk := newTestBreaker()

	for i := 0; i < loopBreakerThreshold-1; i++ {
		ok, _ := b.allow("42", "openai/gpt-4o")
		if !ok {
			t.Fatalf("request %d: allow = false, want true (below threshold)", i+1)
		}
		clk.advance(100 * time.Millisecond) // 4 requests inside 1 s
	}

	ok, retryAfter := b.allow("42", "openai/gpt-4o")
	if ok {
		t.Fatal("5th request within 1 s: allow = true, want false (circuit must open)")
	}
	if retryAfter != loopBreakerOpenFor {
		t.Errorf("retryAfter = %v, want %v", retryAfter, loopBreakerOpenFor)
	}
}

// TestLoopBreaker_SlidingWindow asserts 5 requests spread over MORE than 1 s
// do not trip (the window slides; old hits expire).
func TestLoopBreaker_SlidingWindow(t *testing.T) {
	b, clk := newTestBreaker()

	for i := 0; i < 10; i++ {
		ok, _ := b.allow("42", "openai/gpt-4o")
		if !ok {
			t.Fatalf("request %d: allow = false, want true (300 ms apart → max 4 in any 1 s window)", i+1)
		}
		clk.advance(300 * time.Millisecond)
	}
}

// TestLoopBreaker_OpenCircuitRejectsUntilCooldown asserts requests during the
// 30 s open period are rejected and the circuit closes afterwards.
func TestLoopBreaker_OpenCircuitRejectsUntilCooldown(t *testing.T) {
	b, clk := newTestBreaker()

	for i := 0; i < loopBreakerThreshold; i++ {
		b.allow("42", "openai/gpt-4o")
	}

	clk.advance(29 * time.Second)
	if ok, _ := b.allow("42", "openai/gpt-4o"); ok {
		t.Fatal("allow = true at t+29s, want false (circuit open for 30 s)")
	}

	clk.advance(2 * time.Second) // t+31s > 30 s cooldown
	if ok, _ := b.allow("42", "openai/gpt-4o"); !ok {
		t.Fatal("allow = false after cooldown elapsed, want true (circuit closes)")
	}
}

// TestLoopBreaker_TuplesAreIndependent asserts a tripped (project, model) does
// not affect a different project or a different model.
func TestLoopBreaker_TuplesAreIndependent(t *testing.T) {
	b, _ := newTestBreaker()

	for i := 0; i < loopBreakerThreshold; i++ {
		b.allow("42", "openai/gpt-4o")
	}
	if ok, _ := b.allow("42", "openai/gpt-4o"); ok {
		t.Fatal("tripped tuple must be open")
	}
	if ok, _ := b.allow("43", "openai/gpt-4o"); !ok {
		t.Error("different project must be unaffected")
	}
	if ok, _ := b.allow("42", "anthropic/claude-sonnet-5"); !ok {
		t.Error("different model must be unaffected")
	}
}

// TestLoopBreaker_KeyCollisionResistance asserts the tuple key cannot be forged
// across the project/model boundary (separator is not a legal ID character).
func TestLoopBreaker_KeyCollisionResistance(t *testing.T) {
	if loopKey("1", "2/model") == loopKey("12", "/model") {
		t.Fatal("loopKey must not collide across the project/model boundary")
	}
}

// TestLoopBreaker_MapBounded asserts the tuple table stays within
// loopBreakerMaxTuples and that overflow degrades to admit (never blocks
// honest traffic on a full table).
func TestLoopBreaker_MapBounded(t *testing.T) {
	b, clk := newTestBreaker()

	// Fill the table with live tuples (all inside the window).
	for i := 0; i < loopBreakerMaxTuples; i++ {
		b.allow("p", "model-"+itoa(i))
	}
	if len(b.hits) > loopBreakerMaxTuples {
		t.Fatalf("hits table = %d tuples, must stay <= %d", len(b.hits), loopBreakerMaxTuples)
	}

	// One more NEW tuple while the table is full of live entries → admitted.
	if ok, _ := b.allow("p", "overflow-model"); !ok {
		t.Fatal("overflow tuple must be admitted (degrade to inactive, not block)")
	}

	// After the window passes, stale tuples are prunable and new tuples track.
	clk.advance(2 * time.Second)
	if ok, _ := b.allow("p", "post-prune-model"); !ok {
		t.Fatal("post-prune tuple must be admitted")
	}
	if len(b.hits) > loopBreakerMaxTuples {
		t.Fatalf("hits table = %d tuples after prune, must stay <= %d", len(b.hits), loopBreakerMaxTuples)
	}
}

// itoa is a tiny helper to avoid strconv in the hot loop above.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [12]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}
