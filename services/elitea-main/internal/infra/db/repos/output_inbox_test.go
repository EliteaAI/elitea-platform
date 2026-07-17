package repos

import (
	"context"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"google.golang.org/protobuf/proto"
)

func TestOutputRecordCouplesPayloadTypeToTerminalOutcome(t *testing.T) {
	validation, _, err := validationOutputRecord(testValidationFrame(t))
	if err != nil {
		t.Fatal(err)
	}
	runtimeFailure := validation
	runtimeFailure.PayloadType = payloadTypeRuntimeFailure
	runtimeFailure.SettlementOutcome = executionapp.SettlementFailed

	tests := []struct {
		name    string
		record  outputRecord
		wantErr bool
	}{
		{name: "validation success", record: validation},
		{name: "runtime failure", record: runtimeFailure},
		{name: "cancelled runtime failure", record: withSettlementOutcome(runtimeFailure, executionapp.SettlementCancelled)},
		{name: "cancelled validation", record: withSettlementOutcome(validation, executionapp.SettlementCancelled), wantErr: true},
		{name: "successful runtime failure", record: withSettlementOutcome(runtimeFailure, executionapp.SettlementSucceeded), wantErr: true},
		{name: "outcome unknown runtime failure", record: withSettlementOutcome(runtimeFailure, executionapp.SettlementOutcomeUnknown), wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := test.record.validate()
			if test.wantErr && !errors.Is(err, outputapp.ErrInvalidValidationOutput) {
				t.Fatalf("expected invalid output, got %v", err)
			}
			if !test.wantErr && err != nil {
				t.Fatalf("expected valid output, got %v", err)
			}
		})
	}
}

func TestInsertOutputInboxCancellationPredicateIsNarrow(t *testing.T) {
	validation, _, err := validationOutputRecord(testValidationFrame(t))
	if err != nil {
		t.Fatal(err)
	}
	cancelledFailure := validation
	cancelledFailure.PayloadType = payloadTypeRuntimeFailure
	cancelledFailure.SettlementOutcome = executionapp.SettlementCancelled

	executor := &scriptedExecutor{rowResults: []scriptedRow{{values: []any{"claim-1", "claim-1", "CANCELLED", false, false}}}}
	result, err := insertOutputInbox(context.Background(), executor, cancelledFailure)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Inserted || result.CancellationRejected {
		t.Fatal("correctly fenced cancelled runtime failure was not inserted")
	}
	if len(executor.rowCalls) != 1 {
		t.Fatalf("unexpected insert query count: %d", len(executor.rowCalls))
	}
	call := executor.rowCalls[0]
	for _, predicate := range []string{
		"authority.desired_state = 'RUNNING'",
		"authority.desired_state = 'CANCELLED'",
		"$14 = 'RUNTIME_FAILURE'",
		"$18 = 'CANCELLED'",
	} {
		if !strings.Contains(call.sql, predicate) {
			t.Fatalf("output admission SQL is missing %q", predicate)
		}
	}
	if len(call.args) != 27 {
		t.Fatalf("unexpected output insert argument count: %d", len(call.args))
	}
	if call.args[13] != payloadTypeRuntimeFailure || call.args[17] != string(executionapp.SettlementCancelled) {
		t.Fatalf("cancellation predicate is not bound to runtime failure/cancelled: payload=%v outcome=%v", call.args[13], call.args[17])
	}
}

func TestInsertOutputInboxValidationSuccessHasNoCancellationAdmissionPath(t *testing.T) {
	record, _, err := validationOutputRecord(testValidationFrame(t))
	if err != nil {
		t.Fatal(err)
	}
	executor := &scriptedExecutor{rowResults: []scriptedRow{{values: []any{"", "", "", false, false}}}}
	result, err := insertOutputInbox(context.Background(), executor, record)
	if err != nil {
		t.Fatal(err)
	}
	if result.Inserted || result.CancellationRejected {
		t.Fatal("validation success was inserted without a matching running claim")
	}
	call := executor.rowCalls[0]
	if call.args[13] != payloadTypeConfigurationValidation || call.args[17] != string(executionapp.SettlementSucceeded) {
		t.Fatalf("ordinary validation unexpectedly matched the cancellation pair: payload=%v outcome=%v", call.args[13], call.args[17])
	}
	if !strings.Contains(call.sql, "authority.desired_state = 'CANCELLED'") || !strings.Contains(call.sql, "$14 = 'RUNTIME_FAILURE'") || !strings.Contains(call.sql, "$18 = 'CANCELLED'") {
		t.Fatal("validation success rejection is not enforced by the cancellation predicate")
	}
}

func TestInsertOutputInboxReturnsTypedCancellationLinearizationOnlyForExactAuthority(t *testing.T) {
	record, _, err := validationOutputRecord(testValidationFrame(t))
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name      string
		row       []any
		cancelled bool
	}{
		{name: "exact cancelled authority", row: []any{"", "claim-1", "CANCELLED", false, false}, cancelled: true},
		{name: "stale authority", row: []any{"", "", "", false, false}},
		{name: "draining authority", row: []any{"", "claim-1", "DRAINING", false, false}},
		{name: "existing conflict", row: []any{"", "claim-1", "CANCELLED", true, false}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			executor := &scriptedExecutor{rowResults: []scriptedRow{{values: test.row}}}
			result, err := insertOutputInbox(context.Background(), executor, record)
			if err != nil {
				t.Fatal(err)
			}
			if result.Inserted || result.CancellationRejected != test.cancelled {
				t.Fatalf("unexpected insert result: %+v", result)
			}
			if !strings.Contains(executor.rowCalls[0].sql, "FOR UPDATE OF j, o, c") {
				t.Fatal("output/cancellation decision is not serialized on the job and claim")
			}
		})
	}
}

func TestInsertOutputInboxDatabaseDeadlineAllowsOnlyCanonicalFirstFailure(t *testing.T) {
	nonDeadline, _, err := validationOutputRecord(testValidationFrame(t))
	if err != nil {
		t.Fatal(err)
	}
	deadline := nonDeadline
	deadline.PayloadType = payloadTypeRuntimeFailure
	deadline.SettlementOutcome = executionapp.SettlementFailed
	deadlineMessage := &runtimev1.RuntimeErrorV1{
		Code:        runtimev1.RuntimeErrorCodeV1_RUNTIME_ERROR_CODE_V1_DEADLINE_EXCEEDED,
		SafeMessage: outputapp.DeadlineExceededSafeMessage,
		Retryable:   true,
	}
	deadline.PayloadBytes, err = proto.MarshalOptions{Deterministic: true}.Marshal(deadlineMessage)
	if err != nil {
		t.Fatal(err)
	}
	deadline.PayloadDigest = runtimedomain.SHA256(deadline.PayloadBytes)

	tests := []struct {
		name             string
		record           outputRecord
		row              []any
		wantInserted     bool
		wantDeadlineLost bool
	}{
		{
			name:             "late success loses",
			record:           nonDeadline,
			row:              []any{"", "claim-1", "RUNNING", false, true},
			wantDeadlineLost: true,
		},
		{
			name:         "canonical deadline is admitted",
			record:       deadline,
			row:          []any{"claim-1", "claim-1", "RUNNING", false, true},
			wantInserted: true,
		},
		{
			name:   "existing output identity is not replaced",
			record: nonDeadline,
			row:    []any{"", "claim-1", "RUNNING", true, true},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			executor := &scriptedExecutor{rowResults: []scriptedRow{{values: test.row}}}
			result, err := insertOutputInbox(context.Background(), executor, test.record)
			if err != nil {
				t.Fatal(err)
			}
			if result.Inserted != test.wantInserted || result.DeadlineRejected != test.wantDeadlineLost {
				t.Fatalf("unexpected deadline linearization: %+v", result)
			}
			call := executor.rowCalls[0]
			for _, fragment := range []string{
				"JOIN elitea_runtime.command_outbox AS o",
				"o.authority_granted_at IS NOT NULL",
				"o.deadline <= clock_timestamp() AS deadline_expired",
				"NOT authority.deadline_expired OR $27",
				"FOR UPDATE OF j, o, c",
			} {
				if !strings.Contains(call.sql, fragment) {
					t.Fatalf("output deadline SQL is missing %q", fragment)
				}
			}
			if got := call.args[26]; got != isCanonicalDeadlineOutput(test.record) {
				t.Fatalf("canonical deadline binding changed: got=%v", got)
			}
		})
	}
}

func withSettlementOutcome(record outputRecord, outcome executionapp.SettlementOutcome) outputRecord {
	record.SettlementOutcome = outcome
	return record
}
