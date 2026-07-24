package budgetwriteback

import (
	"encoding/json"
	"testing"
)

func validDelta() BudgetDelta {
	return BudgetDelta{
		EventID:      "11111111-1111-1111-1111-111111111111",
		Scope:        "project",
		ScopeID:      "42",
		ProjectID:    42,
		PeriodStart:  1_700_000_000,
		PeriodEnd:    1_702_600_000,
		DeltaNanoUSD: 2_500_000_000, // $2.50
	}
}

func TestValidate_Accepts(t *testing.T) {
	if err := validDelta().validate(); err != nil {
		t.Fatalf("valid delta rejected: %v", err)
	}
	// A negative delta (correction) is valid.
	d := validDelta()
	d.DeltaNanoUSD = -1_000_000_000
	if err := d.validate(); err != nil {
		t.Fatalf("negative correction rejected: %v", err)
	}
}

func TestValidate_Rejects(t *testing.T) {
	cases := map[string]func(*BudgetDelta){
		"empty event_id":      func(d *BudgetDelta) { d.EventID = "" },
		"empty scope":         func(d *BudgetDelta) { d.Scope = "" },
		"empty scope_id":      func(d *BudgetDelta) { d.ScopeID = "" },
		"zero project_id":     func(d *BudgetDelta) { d.ProjectID = 0 },
		"negative project_id": func(d *BudgetDelta) { d.ProjectID = -5 },
		"zero period_start":   func(d *BudgetDelta) { d.PeriodStart = 0 },
		"period_end <= start": func(d *BudgetDelta) { d.PeriodEnd = d.PeriodStart },
		"period_end < start":  func(d *BudgetDelta) { d.PeriodEnd = d.PeriodStart - 1 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			d := validDelta()
			mutate(&d)
			if err := d.validate(); err == nil {
				t.Errorf("%s: expected validation error, got nil", name)
			}
		})
	}
}

func TestKey_CoalescesByScopeScopeIDPeriod(t *testing.T) {
	a := validDelta()
	b := validDelta()
	b.EventID = "22222222-2222-2222-2222-222222222222"
	b.DeltaNanoUSD = 999 // different amount, same key
	if a.key() != b.key() {
		t.Fatalf("same (scope,scope_id,period_start) must coalesce: %v vs %v", a.key(), b.key())
	}

	c := validDelta()
	c.PeriodStart = a.PeriodStart + 1
	if a.key() == c.key() {
		t.Fatal("different period_start must NOT coalesce")
	}

	d := validDelta()
	d.ScopeID = "43"
	if a.key() == d.key() {
		t.Fatal("different scope_id must NOT coalesce")
	}
}

// TestDeltaJSONRoundTrip pins the wire contract the gateway's Update* path must
// publish (design §8.6). The minimal example fields plus the schema-required
// project_id / period_end must all survive a JSON round-trip.
func TestDeltaJSONRoundTrip(t *testing.T) {
	org := 7
	in := validDelta()
	in.OrgID = &org
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out BudgetDelta
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.EventID != in.EventID || out.Scope != in.Scope || out.ScopeID != in.ScopeID ||
		out.ProjectID != in.ProjectID || out.PeriodStart != in.PeriodStart ||
		out.PeriodEnd != in.PeriodEnd || out.DeltaNanoUSD != in.DeltaNanoUSD {
		t.Errorf("round-trip mismatch: %+v vs %+v", out, in)
	}
	if out.OrgID == nil || *out.OrgID != org {
		t.Errorf("org_id lost in round-trip: %v", out.OrgID)
	}

	// The §8.6 example payload uses snake_case keys; assert them explicitly so a
	// future rename can't silently break the gateway↔scheduler contract.
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal map: %v", err)
	}
	for _, k := range []string{"event_id", "scope", "scope_id", "project_id", "period_start", "period_end", "delta_nano_usd"} {
		if _, ok := m[k]; !ok {
			t.Errorf("wire payload missing key %q", k)
		}
	}
}

// TestOrgIDOmittedWhenNil confirms org_id is omitted (not null) when unset, so a
// scope without an org produces a clean payload.
func TestOrgIDOmittedWhenNil(t *testing.T) {
	raw, _ := json.Marshal(validDelta())
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	if _, ok := m["org_id"]; ok {
		t.Errorf("org_id should be omitted when nil, got %v", m["org_id"])
	}
}
