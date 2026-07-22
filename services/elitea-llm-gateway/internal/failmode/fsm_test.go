package failmode

import (
	"testing"
	"time"
)

func TestResolveFailMode(t *testing.T) {
	tests := []struct {
		name       string
		perProject string
		baseline   FailMode
		want       FailMode
	}{
		{"empty inherits baseline", "", ModeTieredHybrid, ModeTieredHybrid},
		{"valid override wins", "fail_open", ModeTieredHybrid, ModeFailOpen},
		{"fail_closed override wins", "fail_closed", ModeFailOpen, ModeFailClosed},
		{"tiered_hybrid override", "tiered_hybrid", ModeFailClosed, ModeTieredHybrid},
		{"typo falls back to baseline", "fail-open", ModeFailClosed, ModeFailClosed},
		{"garbage falls back", "nonsense", ModeTieredHybrid, ModeTieredHybrid},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := ResolveFailMode(tc.perProject, tc.baseline); got != tc.want {
				t.Fatalf("ResolveFailMode(%q,%v) = %v, want %v", tc.perProject, tc.baseline, got, tc.want)
			}
		})
	}
}

func TestStateString(t *testing.T) {
	cases := map[State]string{
		StateNATSHealthy:     "NATS_HEALTHY",
		StateDownPGFreshSafe: "NATS_DOWN_PG_FRESH_SAFE",
		StateDownPGFreshNear: "NATS_DOWN_PG_FRESH_NEAR",
		StateDownPGFreshOver: "NATS_DOWN_PG_FRESH_OVER",
		StateDownPGStale:     "NATS_DOWN_PG_STALE",
		StateForcedClosed:    "NATS_DOWN_FORCED_CLOSED",
		State(99):            "UNKNOWN",
	}
	for st, want := range cases {
		if got := st.String(); got != want {
			t.Errorf("State(%d).String() = %q, want %q", st, got, want)
		}
	}
}

// tieredParams is a baseline tiered_hybrid Params with a 5m freshness window,
// 1 expected replica, and no absolute degraded cap.
func tieredParams() Params {
	return Params{
		Mode:             ModeTieredHybrid,
		PGFreshness:      5 * time.Minute,
		ExpectedReplicas: 1,
	}
}

func TestDecide_Healthy(t *testing.T) {
	limit := int64(100) * NanoUSD
	snap := Snapshot{HardLimitNano: limit, Found: true}

	t.Run("under limit allows", func(t *testing.T) {
		d := Decide(true, limit-1, 0, snap, 0, tieredParams())
		if d.Verdict != Allow || d.State != StateNATSHealthy || d.Degraded {
			t.Fatalf("got %+v", d)
		}
	})
	t.Run("at limit blocks 402", func(t *testing.T) {
		d := Decide(true, limit, 0, snap, 0, tieredParams())
		if d.Verdict != Block402 || d.State != StateNATSHealthy {
			t.Fatalf("got %+v", d)
		}
	})
	t.Run("unlimited always allows", func(t *testing.T) {
		d := Decide(true, limit*10, 0, Snapshot{IsUnlimited: true}, 0, tieredParams())
		if d.Verdict != Allow || d.State != StateNATSHealthy {
			t.Fatalf("got %+v", d)
		}
	})
}

func TestDecide_ForcedClosedOverridesEverything(t *testing.T) {
	p := tieredParams()
	p.OutageExceededMax = true

	// Even unlimited + fail_open must be 503 under FORCED_CLOSED.
	p.Mode = ModeFailOpen
	d := Decide(false, 0, 0, Snapshot{IsUnlimited: true}, 0, p)
	if d.Verdict != Block503 || d.State != StateForcedClosed || !d.Degraded {
		t.Fatalf("forced-closed did not override fail_open/unlimited: %+v", d)
	}
}

func TestDecide_ExplicitModes(t *testing.T) {
	snap := Snapshot{HardLimitNano: 100 * NanoUSD, Found: true}

	t.Run("fail_closed blocks 402 while down", func(t *testing.T) {
		p := tieredParams()
		p.Mode = ModeFailClosed
		d := Decide(false, 0, 0, snap, 0, p)
		if d.Verdict != Block402 || !d.Degraded {
			t.Fatalf("got %+v", d)
		}
	})
	t.Run("fail_open allows while down", func(t *testing.T) {
		p := tieredParams()
		p.Mode = ModeFailOpen
		d := Decide(false, 0, 0, snap, 0, p)
		if d.Verdict != Allow || !d.Degraded {
			t.Fatalf("got %+v", d)
		}
	})
}

func TestDecide_UnlimitedWhileDown(t *testing.T) {
	d := Decide(false, 0, 0, Snapshot{IsUnlimited: true}, 0, tieredParams())
	if d.Verdict != Allow || d.State != StateDownPGFreshSafe || !d.Degraded {
		t.Fatalf("got %+v", d)
	}
}

func TestDecide_StaleSnapshot(t *testing.T) {
	p := tieredParams()
	snap := Snapshot{
		HardLimitNano:   100 * NanoUSD,
		AccumulatedNano: 10 * NanoUSD,
		Found:           true,
		Age:             6 * time.Minute, // ≥ 5m freshness
	}
	d := Decide(false, 0, 0, snap, 0, p)
	if d.Verdict != Block503 || d.State != StateDownPGStale || !d.Degraded {
		t.Fatalf("stale snapshot should 503: %+v", d)
	}
}

func TestDecide_MissingRowIsFreshZero(t *testing.T) {
	// Found=false ⇒ no spend yet this period ⇒ treated fresh even with a large Age.
	p := tieredParams()
	snap := Snapshot{
		HardLimitNano: 100 * NanoUSD,
		Found:         false,
		Age:           time.Hour,
	}
	d := Decide(false, 0, 0, snap, 0, p)
	if d.Verdict != Allow || d.State != StateDownPGFreshSafe {
		t.Fatalf("missing row should be fresh-safe allow: %+v", d)
	}
}

func TestDecide_FreshOver(t *testing.T) {
	p := tieredParams()
	snap := Snapshot{
		HardLimitNano:   100 * NanoUSD,
		AccumulatedNano: 100 * NanoUSD, // at limit
		Found:           true,
	}
	d := Decide(false, 0, 0, snap, 0, p)
	if d.Verdict != Block402 || d.State != StateDownPGFreshOver {
		t.Fatalf("at-limit while down should 402 over: %+v", d)
	}
}

func TestDecide_FreshNear_PerReplicaCap(t *testing.T) {
	// limit=100, accumulated=90 (≥80% soft), remaining=10 split across 2 replicas
	// ⇒ per-replica cap = 5.
	p := tieredParams()
	p.ExpectedReplicas = 2
	snap := Snapshot{
		HardLimitNano:   100 * NanoUSD,
		AccumulatedNano: 90 * NanoUSD,
		SoftAlertPct:    80,
		Found:           true,
	}
	t.Run("under per-replica cap allows", func(t *testing.T) {
		d := Decide(false, 0, 4*NanoUSD /*already billed*/, snap, 1*NanoUSD /*req*/, p)
		if d.Verdict != Allow || d.State != StateDownPGFreshNear {
			t.Fatalf("got %+v", d)
		}
	})
	t.Run("over per-replica cap blocks 402", func(t *testing.T) {
		d := Decide(false, 0, 4*NanoUSD, snap, 2*NanoUSD, p) // 4+2=6 > cap 5
		if d.Verdict != Block402 || d.State != StateDownPGFreshNear {
			t.Fatalf("got %+v", d)
		}
	})
}

func TestDecide_FreshNear_DefaultSoftPct(t *testing.T) {
	// soft_alert_pct=0 ⇒ treated as 80%. accumulated=80 sits exactly on the
	// NEAR boundary.
	p := tieredParams()
	snap := Snapshot{
		HardLimitNano:   100 * NanoUSD,
		AccumulatedNano: 80 * NanoUSD,
		SoftAlertPct:    0,
		Found:           true,
	}
	d := Decide(false, 0, 0, snap, 0, p)
	if d.State != StateDownPGFreshNear {
		t.Fatalf("80%% with default soft pct should be NEAR: %+v", d)
	}
}

func TestDecide_FreshSafe_DegradedCap(t *testing.T) {
	// Below soft threshold: allow, but bounded by an absolute degraded cap.
	p := tieredParams()
	p.DegradedCapNano = 5 * NanoUSD
	snap := Snapshot{
		HardLimitNano:   100 * NanoUSD,
		AccumulatedNano: 10 * NanoUSD, // well below 80
		SoftAlertPct:    80,
		Found:           true,
	}
	t.Run("under cap allows", func(t *testing.T) {
		d := Decide(false, 0, 4*NanoUSD, snap, 1*NanoUSD, p) // 4+1=5, not > 5
		if d.Verdict != Allow || d.State != StateDownPGFreshSafe {
			t.Fatalf("got %+v", d)
		}
	})
	t.Run("over cap blocks 402", func(t *testing.T) {
		d := Decide(false, 0, 5*NanoUSD, snap, 1*NanoUSD, p) // 6 > 5
		if d.Verdict != Block402 || d.State != StateDownPGFreshSafe {
			t.Fatalf("got %+v", d)
		}
	})
	t.Run("no cap set allows unbounded", func(t *testing.T) {
		p2 := tieredParams() // DegradedCapNano = 0 ⇒ disabled
		d := Decide(false, 0, 1_000*NanoUSD, snap, 1_000*NanoUSD, p2)
		if d.Verdict != Allow || d.State != StateDownPGFreshSafe {
			t.Fatalf("got %+v", d)
		}
	})
}

func TestDecide_NonPositiveLimitAllows(t *testing.T) {
	// Budgeted (not unlimited) but limit ≤ 0 is a config error: allow in SAFE
	// rather than 402 every request.
	p := tieredParams()
	snap := Snapshot{HardLimitNano: 0, Found: true}
	d := Decide(false, 0, 0, snap, 0, p)
	if d.Verdict != Allow || d.State != StateDownPGFreshSafe {
		t.Fatalf("got %+v", d)
	}
}

func TestDecide_ExpectedReplicasFloor(t *testing.T) {
	// ExpectedReplicas < 1 must floor to 1 (no divide-by-zero).
	p := tieredParams()
	p.ExpectedReplicas = 0
	snap := Snapshot{
		HardLimitNano:   100 * NanoUSD,
		AccumulatedNano: 90 * NanoUSD,
		SoftAlertPct:    80,
		Found:           true,
	}
	// remaining=10, N floored to 1 ⇒ cap 10; req 10 allowed, 11 blocked.
	if d := Decide(false, 0, 0, snap, 10*NanoUSD, p); d.Verdict != Allow {
		t.Fatalf("req at cap should allow: %+v", d)
	}
	if d := Decide(false, 0, 0, snap, 11*NanoUSD, p); d.Verdict != Block402 {
		t.Fatalf("req over cap should 402: %+v", d)
	}
}
