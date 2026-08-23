package agentexecution

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

func TestCurrentApplicationRegenerationReusesResponseWithFreshGeneration(t *testing.T) {
	resolver := &currentApplicationResolverStub{
		regenerationTarget: CurrentRegenerationTarget{
			Kind:                CurrentRegenerationApplication,
			ConversationUUID:    "8bc66e50-46c4-4e2c-94ec-daec6c596ac0",
			TargetParticipantID: 21,
			QuestionID:          "ee92ccbd-3312-4c72-b20b-fddf224e7c0e",
			UserInput:           "authoritative original question",
		},
		target: CurrentApplicationTarget{
			ApplicationID: 31, ApplicationVersionID: 41,
			Variables: json.RawMessage(`[]`),
			VersionDetails: json.RawMessage(`{
  "id":41,"application_id":31,"agent_type":"agent","instructions":"Be concise",
  "llm_settings":{"model_name":"test","model_project_id":7,"openai_compatible":false},
  "meta":{},"tools":[]
}`),
			ChatHistory: json.RawMessage(`[{
  "role":"user","content":[{"type":"text","text":"earlier"}],"additional_kwargs":{}
}]`),
		},
	}
	admittedAt := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	admissions := &currentApplicationAdmissionStub{outcome: executionapp.AdmissionOutcome{
		ExecutionID: "execution-regenerate", CommandID: "command-regenerate", Created: true,
		AdmittedAt: admittedAt, Deadline: admittedAt.Add(time.Minute),
	}}
	service, err := NewCurrentApplicationStartService(
		resolver, resolver, resolver, resolver, resolver, &currentAgentGuardrailStub{},
		&currentApplicationVersionFreezerStub{}, admissions,
	)
	if err != nil {
		t.Fatal(err)
	}
	request := validCurrentRegenerationRequest()
	outcome, err := service.RegenerateCurrentAgent(context.Background(), request)
	if err != nil {
		t.Fatalf("RegenerateCurrentAgent() error = %v", err)
	}
	if outcome.ExecutionID != "execution-regenerate" ||
		outcome.ResponseMessageID != request.ResponseMessageID || len(admissions.requests) != 1 {
		t.Fatalf("outcome=%+v admissions=%d", outcome, len(admissions.requests))
	}
	admission := admissions.requests[0]
	turn := admission.CurrentRegenerateTurn
	if admission.CapabilityID != executiondomain.AgentApplicationCapability ||
		admission.IdempotencyKey != "regenerate/"+request.ResponseMessageID+"/"+request.RegenerationID ||
		admission.CurrentTurn != nil || admission.CurrentAdhocTurn != nil || turn == nil ||
		turn.Kind != CurrentRegenerationApplication || turn.QuestionID != request.QuestionID ||
		turn.ResponseMessageID != request.ResponseMessageID ||
		turn.ExecutionGeneration != request.RegenerationID ||
		turn.ApplicationID != 31 || turn.ApplicationVersionID != 41 {
		t.Fatalf("admission=%+v turn=%+v", admission, turn)
	}
	if !admission.Input.IsRegenerate || admission.Input.GetExecutionGeneration() != request.RegenerationID ||
		string(admission.Input.UserInput) != `"authoritative original question"` ||
		string(admission.Input.ChatHistory) != string(resolver.target.ChatHistory) {
		t.Fatalf("input=%+v user=%s history=%s", admission.Input, admission.Input.UserInput, admission.Input.ChatHistory)
	}
}

func TestCurrentRegenerationRejectsBrowserIdentityDriftBeforeAdmission(t *testing.T) {
	resolver := &currentApplicationResolverStub{regenerationTarget: CurrentRegenerationTarget{
		Kind:                CurrentRegenerationAdhoc,
		ConversationUUID:    "8bc66e50-46c4-4e2c-94ec-daec6c596ac0",
		TargetParticipantID: 21,
		QuestionID:          "ee92ccbd-3312-4c72-b20b-fddf224e7c0e",
		UserInput:           "original",
	}}
	admissions := &currentApplicationAdmissionStub{}
	service, err := NewCurrentApplicationStartService(
		resolver, resolver, resolver, resolver, resolver, &currentAgentGuardrailStub{},
		&currentApplicationVersionFreezerStub{}, admissions,
	)
	if err != nil {
		t.Fatal(err)
	}
	request := validCurrentRegenerationRequest()
	request.ConversationUUID = "c438b0d2-f43d-42af-8686-47538e3214a8"
	if _, err := service.RegenerateCurrentAgent(context.Background(), request); err != ErrUnsupportedCurrentAgentStart {
		t.Fatalf("error=%v", err)
	}
	if len(admissions.requests) != 0 {
		t.Fatalf("admissions=%d", len(admissions.requests))
	}
}

func validCurrentRegenerationRequest() CurrentRegenerationRequest {
	return CurrentRegenerationRequest{
		ProjectID: 7, ActorUserID: 11,
		ConversationUUID:       "8bc66e50-46c4-4e2c-94ec-daec6c596ac0",
		QuestionID:             "ee92ccbd-3312-4c72-b20b-fddf224e7c0e",
		ResponseMessageID:      "30e0913e-10d4-43db-b8d0-c7b79480935a",
		RegenerationID:         "9fba0a08-5049-42bb-9019-c2f3df686010",
		RequestedParticipantID: 21,
		LLMSettings:            json.RawMessage(`{}`),
	}
}
