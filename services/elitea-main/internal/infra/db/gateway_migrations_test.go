package db

import (
	"strings"
	"testing"
)

// readGatewaySQL returns the concatenated gateway migration SQL.
func readGatewaySQL(t *testing.T) string {
	t.Helper()
	entries, err := gatewayMigrations.ReadDir("gateway_migrations")
	if err != nil {
		t.Fatalf("read gateway_migrations dir: %v", err)
	}
	var sb strings.Builder
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		data, err := gatewayMigrations.ReadFile("gateway_migrations/" + e.Name())
		if err != nil {
			t.Fatalf("read %s: %v", e.Name(), err)
		}
		sb.Write(data)
		sb.WriteString("\n")
	}
	return sb.String()
}

// TestGatewayMigrationCutoverColumns asserts the six cutover-critical columns
// the BF0.4 validator counts are all declared:
//
//	project_budget.nats_fail_mode, project_budget.soft_alert_pct,
//	llm_budget_accumulators.outage_mode, llm_budget_accumulators.reconciled,
//	llm_credentials.rate_policy, gateway_models.input_cost_per_1m_tokens
func TestGatewayMigrationCutoverColumns(t *testing.T) {
	sql := readGatewaySQL(t)
	for _, col := range []string{
		"nats_fail_mode",
		"soft_alert_pct",
		"outage_mode",
		"reconciled",
		"rate_policy",
		"input_cost_per_1m_tokens",
	} {
		if !strings.Contains(sql, col) {
			t.Errorf("gateway migration missing cutover-critical column %q", col)
		}
	}
}

// TestGatewayMigrationTables asserts each gateway table is created.
func TestGatewayMigrationTables(t *testing.T) {
	sql := readGatewaySQL(t)
	for _, tbl := range []string{
		"gateway.project_budget",
		"gateway.llm_budget_accumulators",
		"gateway.llm_credentials",
		"gateway.gateway_models",
		"gateway.processed_event_ids",
	} {
		if !strings.Contains(sql, "CREATE TABLE IF NOT EXISTS "+tbl) {
			t.Errorf("gateway migration missing idempotent create for %q", tbl)
		}
	}
}

// TestGatewayMigrationIdempotent asserts every DDL statement is guarded so the
// dump-guard-exempt migration set can be re-applied safely.
func TestGatewayMigrationIdempotent(t *testing.T) {
	sql := readGatewaySQL(t)

	// No bare CREATE TABLE / CREATE SCHEMA / CREATE INDEX without IF NOT EXISTS.
	for _, line := range strings.Split(sql, "\n") {
		trimmed := strings.TrimSpace(line)
		up := strings.ToUpper(trimmed)
		switch {
		case strings.HasPrefix(up, "CREATE TABLE ") && !strings.Contains(up, "IF NOT EXISTS"):
			t.Errorf("non-idempotent CREATE TABLE: %q", trimmed)
		case strings.HasPrefix(up, "CREATE SCHEMA ") && !strings.Contains(up, "IF NOT EXISTS"):
			t.Errorf("non-idempotent CREATE SCHEMA: %q", trimmed)
		case strings.HasPrefix(up, "CREATE INDEX ") && !strings.Contains(up, "IF NOT EXISTS"):
			t.Errorf("non-idempotent CREATE INDEX: %q", trimmed)
		case strings.HasPrefix(up, "ALTER TABLE ") && strings.Contains(up, "ADD COLUMN") && !strings.Contains(up, "IF NOT EXISTS"):
			t.Errorf("non-idempotent ADD COLUMN: %q", trimmed)
		}
	}
}

// TestGatewayMigrationPricePer1M guards the denomination invariant: the price
// column MUST be per-1M-token, never per-1k or per-token (§7.1 1000× bug).
func TestGatewayMigrationPricePer1M(t *testing.T) {
	sql := readGatewaySQL(t)
	if !strings.Contains(sql, "input_cost_per_1m_tokens") {
		t.Fatal("gateway_models must use the per-1M-token denomination")
	}
	if strings.Contains(sql, "input_cost_per_1k_tokens") || strings.Contains(sql, "input_cost_per_token ") {
		t.Error("gateway_models must NOT use a per-1k or per-token denomination (1000× costing bug)")
	}
}

// TestRatePolicyCheckConstraint asserts the CHECK constraint enumerates exactly
// the three policies from §8.7.
func TestRatePolicyCheckConstraint(t *testing.T) {
	sql := readGatewaySQL(t)
	for _, p := range []string{"'billed'", "'zero-rate-metered'", "'excluded'"} {
		if !strings.Contains(sql, p) {
			t.Errorf("rate_policy CHECK missing %s", p)
		}
	}
}

// TestNatsFailModeCheckConstraint asserts the fail-mode enumeration (§8.5).
func TestNatsFailModeCheckConstraint(t *testing.T) {
	sql := readGatewaySQL(t)
	for _, m := range []string{"'tiered_hybrid'", "'fail_open'", "'fail_closed'"} {
		if !strings.Contains(sql, m) {
			t.Errorf("nats_fail_mode CHECK missing %s", m)
		}
	}
}
