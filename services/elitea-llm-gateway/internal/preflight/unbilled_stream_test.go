package preflight

import (
	"encoding/json"
	"testing"
)

// TestFakeNATS_OpsEventsAreSeparateFromTenantAlerts exercises the operator-only
// capture path in the harness — which otherwise carries accessors no test ever
// reads, i.e. scaffolding that documents an assertion nobody makes.
//
// The property under test is the one that made the port separate in the first
// place (issue #9): budget.unbilled_stream records which streams the gateway
// failed to bill, and it must land in the operator channel, never in the
// per-project stream elitea-main relays to project members.
func TestFakeNATS_OpsEventsAreSeparateFromTenantAlerts(t *testing.T) {
	nc := NewFakeNATS()

	soft, err := json.Marshal(map[string]string{"type": "budget.soft_alert"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	unbilled, err := json.Marshal(map[string]string{"type": "budget.unbilled_stream"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	if err := nc.PublishSoftAlertEvent(t.Context(), "42", soft); err != nil {
		t.Fatalf("PublishSoftAlertEvent: %v", err)
	}
	if err := nc.PublishOpsEvent(t.Context(), unbilled); err != nil {
		t.Fatalf("PublishOpsEvent: %v", err)
	}

	if got := nc.OpsEventCount(); got != 1 {
		t.Errorf("OpsEventCount = %d, want 1", got)
	}
	if got := nc.AlertEventCount(); got != 1 {
		t.Errorf("AlertEventCount = %d, want 1", got)
	}
	// The tenant-facing capture must not contain the unbilled-stream record.
	for _, rec := range nc.AlertEvents {
		var env struct {
			Type string `json:"type"`
		}
		_ = json.Unmarshal(rec.Event, &env)
		if env.Type == "budget.unbilled_stream" {
			t.Error("budget.unbilled_stream reached the per-project (tenant-relayed) channel; it is " +
				"an operator-only record and would otherwise tell a project which of its streams " +
				"went unbilled")
		}
	}
}
