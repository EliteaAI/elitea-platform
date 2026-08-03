package agentexecution

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	"google.golang.org/protobuf/proto"
)

type currentApplicationResolverStub struct {
	target CurrentApplicationTarget
	err    error
	calls  int
}

type currentApplicationVersionFreezerStub struct {
	result json.RawMessage
	err    error
	calls  []CurrentApplicationVersionFreezeRequest
}

func (stub *currentApplicationVersionFreezerStub) FreezeCurrentApplicationVersion(
	_ context.Context,
	request CurrentApplicationVersionFreezeRequest,
) (json.RawMessage, error) {
	request.VersionDetails = bytes.Clone(request.VersionDetails)
	stub.calls = append(stub.calls, request)
	if stub.result != nil {
		return bytes.Clone(stub.result), stub.err
	}
	return bytes.Clone(request.VersionDetails), stub.err
}

func (stub *currentApplicationResolverStub) ResolveInitialCurrentApplication(
	_ context.Context,
	_ CurrentApplicationStartRequest,
) (CurrentApplicationTarget, error) {
	stub.calls++
	return stub.target, stub.err
}

type currentApplicationAdmissionStub struct {
	requests []SubmitRequest
	outcome  executionapp.AdmissionOutcome
	err      error
}

func (stub *currentApplicationAdmissionStub) Submit(
	_ context.Context,
	request SubmitRequest,
) (executionapp.AdmissionOutcome, error) {
	request.Input = proto.Clone(request.Input).(*runtimeAgentInput)
	request.CurrentTurn = request.CurrentTurn.Clone()
	stub.requests = append(stub.requests, request)
	return stub.outcome, stub.err
}

// Alias keeps the clone assertion readable without leaking generated package
// details into the test expectations below.
type runtimeAgentInput = runtimev1.AgentExecutionInputV1

func TestCurrentApplicationStartBuildsAuthoritativeParityInputAndTurn(t *testing.T) {
	resolver := &currentApplicationResolverStub{target: CurrentApplicationTarget{
		ApplicationID: 31, ApplicationVersionID: 41,
		Variables:      json.RawMessage(`[{"name":"region","value":"eu"}]`),
		VersionDetails: json.RawMessage(`{"id":41,"application_id":31,"agent_type":"agent","instructions":"Be concise","llm_settings":{"model_name":"test"},"meta":{},"tools":[]}`),
	}}
	admittedAt := time.Date(2026, 8, 2, 12, 0, 0, 0, time.UTC)
	admissions := &currentApplicationAdmissionStub{outcome: executionapp.AdmissionOutcome{
		ExecutionID: "execution-1", CommandID: "command-1", Created: true,
		AdmittedAt: admittedAt, Deadline: admittedAt.Add(time.Minute),
	}}
	freezer := &currentApplicationVersionFreezerStub{}
	service, err := NewCurrentApplicationStartService(resolver, freezer, admissions)
	if err != nil {
		t.Fatal(err)
	}
	request := validCurrentApplicationStartRequest()

	outcome, err := service.StartCurrentApplication(context.Background(), request)
	if err != nil {
		t.Fatalf("StartCurrentApplication() error = %v", err)
	}
	if outcome.ExecutionID != "execution-1" || outcome.CommandID != "command-1" ||
		!outcome.Created || outcome.ResponseMessageID == "" || len(admissions.requests) != 1 {
		t.Fatalf("outcome=%+v admissions=%d", outcome, len(admissions.requests))
	}

	submitted := admissions.requests[0]
	if submitted.CapabilityID != executiondomain.AgentApplicationCapability ||
		submitted.SIOEvent != "chat_predict" || submitted.IdempotencyKey != request.QuestionID ||
		submitted.Identity.TenantID != "7" || submitted.Identity.ResourceProjectID != "7" ||
		submitted.Identity.ProjectionProjectID != "7" || submitted.Identity.ActorID != "11" {
		t.Fatalf("admission identity or capability drifted: %+v", submitted)
	}
	if submitted.CurrentTurn == nil || submitted.CurrentTurn.Validate() != nil ||
		submitted.CurrentTurn.ResponseMessageID != outcome.ResponseMessageID ||
		submitted.CurrentTurn.QuestionID != request.QuestionID ||
		submitted.CurrentTurn.UserInput != request.UserInput {
		t.Fatalf("current turn=%+v outcome=%+v", submitted.CurrentTurn, outcome)
	}
	if len(freezer.calls) != 1 || freezer.calls[0].ProjectID != 7 ||
		freezer.calls[0].ActorUserID != 11 {
		t.Fatalf("version freezer calls=%+v", freezer.calls)
	}
	if submitted.Input.GetSchemaRevision() != "elitea.runtime.agent-execution-input.v1" ||
		submitted.Input.GetThreadId() != request.ConversationUUID ||
		submitted.Input.GetConversationId() != request.ConversationUUID ||
		submitted.Input.GetExecutionGeneration() != request.QuestionID ||
		!bytes.Equal(submitted.Input.GetUserInput(), []byte(`"hello"`)) ||
		!bytes.Equal(submitted.Input.GetLlm(), []byte(`{"kwargs":{}}`)) ||
		!bytes.Equal(submitted.Input.GetMcpTokens(), []byte(`{}`)) {
		t.Fatalf("agent input drifted: %+v", submitted.Input)
	}
	var application map[string]any
	if err := json.Unmarshal(submitted.Input.GetApplication(), &application); err != nil ||
		application["id"] != float64(31) || application["version_id"] != float64(41) ||
		application["version_details"].(map[string]any)["instructions"] != "Be concise" {
		t.Fatalf("application=%+v error=%v", application, err)
	}
}

func TestCurrentApplicationStartIsDeterministicAcrossIdempotentRetries(t *testing.T) {
	resolver := &currentApplicationResolverStub{target: CurrentApplicationTarget{
		ApplicationID: 31, ApplicationVersionID: 41, Variables: json.RawMessage(`[]`),
		VersionDetails: json.RawMessage(`{"id":41,"application_id":31,"agent_type":"agent","llm_settings":{"model_name":"test"},"meta":{},"tools":[]}`),
	}}
	admittedAt := time.Date(2026, 8, 2, 12, 0, 0, 0, time.UTC)
	admissions := &currentApplicationAdmissionStub{outcome: executionapp.AdmissionOutcome{
		ExecutionID: "execution-1", CommandID: "command-1", Created: false,
		AdmittedAt: admittedAt, Deadline: admittedAt.Add(time.Minute),
	}}
	service, err := NewCurrentApplicationStartService(
		resolver,
		&currentApplicationVersionFreezerStub{},
		admissions,
	)
	if err != nil {
		t.Fatal(err)
	}
	request := validCurrentApplicationStartRequest()

	first, err := service.StartCurrentApplication(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.StartCurrentApplication(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if first.ResponseMessageID != second.ResponseMessageID || len(admissions.requests) != 2 ||
		!proto.Equal(admissions.requests[0].Input, admissions.requests[1].Input) ||
		!reflect.DeepEqual(admissions.requests[0].CurrentTurn, admissions.requests[1].CurrentTurn) {
		t.Fatal("same current turn produced different durable admission material")
	}
}

func TestCurrentApplicationStartRejectsUnsupportedTargetBeforeAdmission(t *testing.T) {
	resolver := &currentApplicationResolverStub{target: CurrentApplicationTarget{
		ApplicationID: 31, ApplicationVersionID: 41, Variables: json.RawMessage(`{}`),
		VersionDetails: json.RawMessage(`{"id":41}`),
	}}
	admissions := &currentApplicationAdmissionStub{}
	service, err := NewCurrentApplicationStartService(
		resolver,
		&currentApplicationVersionFreezerStub{},
		admissions,
	)
	if err != nil {
		t.Fatal(err)
	}

	_, err = service.StartCurrentApplication(context.Background(), validCurrentApplicationStartRequest())
	if !errors.Is(err, ErrUnsupportedCurrentAgentStart) || len(admissions.requests) != 0 {
		t.Fatalf("error=%v admissions=%d", err, len(admissions.requests))
	}
}

func validCurrentApplicationStartRequest() CurrentApplicationStartRequest {
	return CurrentApplicationStartRequest{
		ProjectID: 7, ActorUserID: 11,
		ConversationUUID:    "8bc66e50-46c4-4e2c-94ec-daec6c596ac0",
		TargetParticipantID: 21,
		QuestionID:          "ee92ccbd-3312-4c72-b20b-fddf224e7c0e",
		UserInput:           "hello",
		InteractionUUID:     "31df012a-300d-4722-9be2-521d987c63a8",
	}
}
