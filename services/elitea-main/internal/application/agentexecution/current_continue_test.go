package agentexecution

import (
	"context"
	"encoding/json"
	"math"
	"testing"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

func TestCurrentContinuationDatabaseIDBoundsCurrentIntegerSchema(t *testing.T) {
	for _, test := range []struct {
		name  string
		value int64
		want  int32
		ok    bool
	}{
		{name: "minimum", value: 1, want: 1, ok: true},
		{name: "maximum", value: math.MaxInt32, want: math.MaxInt32, ok: true},
		{name: "zero", value: 0},
		{name: "negative", value: -1},
		{name: "overflow", value: math.MaxInt32 + 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := currentContinuationDatabaseID(test.value)
			if got != test.want || ok != test.ok {
				t.Fatalf("current continuation database ID = (%d, %t), want (%d, %t)", got, ok, test.want, test.ok)
			}
		})
	}
}

func TestCurrentApplicationContinuationReusesCheckpointAndResponse(t *testing.T) {
	resolver := &currentApplicationResolverStub{
		continuationTarget: CurrentContinuationTarget{
			Kind: CurrentRegenerationApplication, TargetParticipantID: 21,
			QuestionID: "ee92ccbd-3312-4c72-b20b-fddf224e7c0e",
			UserInput:  "delete the stale branch", ThreadID: "thread-current-1",
			ExecutionGeneration: "9fba0a08-5049-42bb-9019-c2f3df686010",
			InterruptID:         "interrupt-sensitive-1",
			AvailableActions:    []string{"approve", "reject", "edit", "block_with_comment"},
		},
		target: CurrentApplicationTarget{
			ApplicationID: 31, ApplicationVersionID: 41,
			Variables: json.RawMessage(`[]`),
			VersionDetails: json.RawMessage(`{
  "id":41,"application_id":31,"agent_type":"agent","instructions":"Be careful",
  "llm_settings":{"model_name":"test","model_project_id":7,"openai_compatible":false},
  "meta":{},"tools":[]
}`),
			ChatHistory: json.RawMessage(`[]`),
		},
	}
	admittedAt := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	admissions := &currentApplicationAdmissionStub{outcome: executionapp.AdmissionOutcome{
		ExecutionID: "execution-continue", CommandID: "command-continue", Created: true,
		AdmittedAt: admittedAt, Deadline: admittedAt.Add(time.Minute),
	}}
	service, err := NewCurrentApplicationStartService(
		resolver, resolver, resolver, resolver,
		&currentApplicationVersionFreezerStub{}, admissions,
	)
	if err != nil {
		t.Fatal(err)
	}
	request := CurrentContinuationRequest{
		ProjectID: 7, ActorUserID: 11,
		ConversationUUID:  "8bc66e50-46c4-4e2c-94ec-daec6c596ac0",
		ResponseMessageID: "30e0913e-10d4-43db-b8d0-c7b79480935a",
		ThreadID:          "thread-current-1", Action: "edit", Value: "delete only merged branches",
	}
	outcome, err := service.ContinueCurrentAgent(context.Background(), request)
	if err != nil {
		t.Fatalf("ContinueCurrentAgent() error = %v", err)
	}
	if outcome.ExecutionID != "execution-continue" || outcome.ResponseMessageID != request.ResponseMessageID ||
		len(admissions.requests) != 1 {
		t.Fatalf("outcome=%+v admissions=%d", outcome, len(admissions.requests))
	}
	admission := admissions.requests[0]
	turn := admission.CurrentContinueTurn
	if admission.CapabilityID != executiondomain.AgentApplicationCapability ||
		admission.SIOEvent != "chat_continue_predict" || admission.CurrentTurn != nil ||
		admission.CurrentAdhocTurn != nil || admission.CurrentRegenerateTurn != nil || turn == nil ||
		turn.ResponseMessageID != request.ResponseMessageID ||
		turn.ExecutionGeneration != resolver.continuationTarget.ExecutionGeneration ||
		turn.ThreadID != resolver.continuationTarget.ThreadID ||
		turn.InterruptID != resolver.continuationTarget.InterruptID ||
		turn.ApplicationID != 31 || turn.ApplicationVersionID != 41 || turn.Action != "edit" {
		t.Fatalf("admission=%+v turn=%+v", admission, turn)
	}
	input := admission.Input
	if !input.HitlResume || !input.ShouldContinue || input.GetHitlAction() != "edit" ||
		input.GetHitlValue() != request.Value || input.GetThreadId() != resolver.continuationTarget.ThreadID ||
		input.GetExecutionGeneration() != resolver.continuationTarget.ExecutionGeneration {
		t.Fatalf("input=%+v", input)
	}
	var decisions []map[string]string
	if err := json.Unmarshal(input.HitlDecisions, &decisions); err != nil || len(decisions) != 1 ||
		decisions[0]["interrupt_id"] != resolver.continuationTarget.InterruptID ||
		decisions[0]["action"] != "edit" || decisions[0]["value"] != request.Value {
		t.Fatalf("decisions=%s error=%v", input.HitlDecisions, err)
	}
}

func TestCurrentApplicationContinuationCarriesBlockWithCommentToOneExactDecision(t *testing.T) {
	resolver := &currentApplicationResolverStub{
		continuationTarget: CurrentContinuationTarget{
			Kind: CurrentRegenerationApplication, TargetParticipantID: 21,
			QuestionID: "ee92ccbd-3312-4c72-b20b-fddf224e7c0e",
			UserInput:  "delete the stale artifact", ThreadID: "thread-current-1",
			ExecutionGeneration: "9fba0a08-5049-42bb-9019-c2f3df686010",
			InterruptID:         "interrupt-sensitive-1",
			AvailableActions:    []string{"approve", "reject", "block_with_comment"},
		},
		target: CurrentApplicationTarget{
			ApplicationID: 31, ApplicationVersionID: 41,
			Variables: json.RawMessage(`[]`),
			VersionDetails: json.RawMessage(`{
  "id":41,"application_id":31,"agent_type":"agent","instructions":"Be careful",
  "llm_settings":{"model_name":"test","model_project_id":7,"openai_compatible":false},
  "meta":{},"tools":[]
}`),
			ChatHistory: json.RawMessage(`[]`),
		},
	}
	admissions := &currentApplicationAdmissionStub{outcome: executionapp.AdmissionOutcome{
		ExecutionID: "execution-comment", CommandID: "command-comment", Created: true,
	}}
	service, err := NewCurrentApplicationStartService(
		resolver, resolver, resolver, resolver,
		&currentApplicationVersionFreezerStub{}, admissions,
	)
	if err != nil {
		t.Fatal(err)
	}
	comment := "append the requested data before retrying the sensitive action"
	_, err = service.ContinueCurrentAgent(context.Background(), CurrentContinuationRequest{
		ProjectID: 7, ActorUserID: 11,
		ConversationUUID:  "8bc66e50-46c4-4e2c-94ec-daec6c596ac0",
		ResponseMessageID: "30e0913e-10d4-43db-b8d0-c7b79480935a",
		ThreadID:          "thread-current-1",
		Action:            "block_with_comment", Value: comment,
	})
	if err != nil || len(admissions.requests) != 1 {
		t.Fatalf("ContinueCurrentAgent() error=%v admissions=%d", err, len(admissions.requests))
	}
	admission := admissions.requests[0]
	if admission.CurrentContinueTurn == nil ||
		admission.CurrentContinueTurn.InterruptID != resolver.continuationTarget.InterruptID ||
		admission.CurrentContinueTurn.Action != "block_with_comment" ||
		admission.Input.GetHitlAction() != "block_with_comment" ||
		admission.Input.GetHitlValue() != comment {
		t.Fatalf("admission=%+v input=%+v", admission.CurrentContinueTurn, admission.Input)
	}
	var decisions []map[string]string
	if err := json.Unmarshal(admission.Input.HitlDecisions, &decisions); err != nil || len(decisions) != 1 ||
		decisions[0]["interrupt_id"] != resolver.continuationTarget.InterruptID ||
		decisions[0]["action"] != "block_with_comment" || decisions[0]["value"] != comment {
		t.Fatalf("decisions=%s error=%v", admission.Input.HitlDecisions, err)
	}
}

func TestCurrentContinuationRejectsUnavailableActionBeforeAdmission(t *testing.T) {
	resolver := &currentApplicationResolverStub{continuationTarget: CurrentContinuationTarget{
		Kind: CurrentRegenerationApplication, TargetParticipantID: 21,
		QuestionID: "ee92ccbd-3312-4c72-b20b-fddf224e7c0e", UserInput: "sensitive action",
		ThreadID: "thread-current-1", ExecutionGeneration: "9fba0a08-5049-42bb-9019-c2f3df686010",
		InterruptID: "interrupt-sensitive-1", AvailableActions: []string{"approve", "reject"},
	}}
	admissions := &currentApplicationAdmissionStub{}
	service, err := NewCurrentApplicationStartService(
		resolver, resolver, resolver, resolver,
		&currentApplicationVersionFreezerStub{}, admissions,
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.ContinueCurrentAgent(context.Background(), CurrentContinuationRequest{
		ProjectID: 7, ActorUserID: 11,
		ConversationUUID:  "8bc66e50-46c4-4e2c-94ec-daec6c596ac0",
		ResponseMessageID: "30e0913e-10d4-43db-b8d0-c7b79480935a",
		Action:            "edit", Value: "replacement",
	})
	if err != ErrUnsupportedCurrentAgentStart || len(admissions.requests) != 0 {
		t.Fatalf("error=%v admissions=%d", err, len(admissions.requests))
	}
}
