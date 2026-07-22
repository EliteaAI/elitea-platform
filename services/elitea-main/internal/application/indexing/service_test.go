package indexing

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

type startResolverStub struct {
	request StartRequest
	inputs  AuthoritativeInputs
	err     error
	calls   int
}

func (s *startResolverStub) Resolve(_ context.Context, request StartRequest) (AuthoritativeInputs, error) {
	s.calls++
	s.request = request.Clone()
	return s.inputs, s.err
}

type startAdmissionStub struct {
	request SubmitRequest
	outcome executionapp.AdmissionOutcome
	err     error
	calls   int
}

func (s *startAdmissionStub) Submit(_ context.Context, request SubmitRequest) (executionapp.AdmissionOutcome, error) {
	s.calls++
	s.request = request
	return s.outcome, s.err
}

func TestStartServiceResolvesThenAdmitsCurrentUserRequest(t *testing.T) {
	now := time.Date(2026, time.July, 22, 12, 0, 0, 0, time.UTC)
	request := validStartServiceRequest()
	inputs := validStartServiceInputs()
	resolver := &startResolverStub{inputs: inputs}
	admissions := &startAdmissionStub{outcome: executionapp.AdmissionOutcome{
		ExecutionID: "execution-1",
		CommandID:   "command-1",
		Created:     true,
		AdmittedAt:  now,
		Deadline:    now.Add(time.Hour),
	}}
	generated := 0
	service, err := NewStartService(resolver, admissions, func() (string, error) {
		generated++
		return "unused", nil
	})
	if err != nil {
		t.Fatal(err)
	}

	outcome, err := service.StartIndexData(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.TaskID != "execution-1" || resolver.calls != 1 || admissions.calls != 1 || generated != 0 {
		t.Fatalf("outcome=%+v resolver=%d admission=%d generated=%d", outcome, resolver.calls, admissions.calls, generated)
	}
	if !reflect.DeepEqual(resolver.request, request) {
		t.Fatalf("resolver request=%+v want=%+v", resolver.request, request)
	}
	wantIdentity := executionapp.AdmissionIdentity{
		TenantID: "7", ResourceProjectID: "7", ProjectionProjectID: "7", ActorID: "11",
	}
	if admissions.request.Identity != wantIdentity || admissions.request.ToolkitID != 42 ||
		admissions.request.Initiator != executiondomain.IndexIngestInitiatorUser ||
		!reflect.DeepEqual(admissions.request.Inputs, inputs) {
		t.Fatalf("admission request=%+v", admissions.request)
	}
	if !strings.HasPrefix(admissions.request.IdempotencyKey, indexStartIdempotencyPrefix) || len(admissions.request.IdempotencyKey) != len(indexStartIdempotencyPrefix)+64 {
		t.Fatalf("idempotency key=%q", admissions.request.IdempotencyKey)
	}

	firstKey := admissions.request.IdempotencyKey
	if _, err := service.StartIndexData(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if admissions.request.IdempotencyKey != firstKey {
		t.Fatal("same current UI correlation produced a different idempotency key")
	}
}

func TestStartServiceUsesGeneratedCorrelationOnlyWhenCurrentIDsAreAbsent(t *testing.T) {
	request := validStartServiceRequest()
	request.StreamID = ""
	request.MessageID = ""
	resolver := &startResolverStub{inputs: validStartServiceInputs()}
	admissions := &startAdmissionStub{outcome: validStartAdmissionOutcome()}
	generated := 0
	service, err := NewStartService(resolver, admissions, func() (string, error) {
		generated++
		return "generated-correlation-" + string(rune('0'+generated)), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartIndexData(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	first := admissions.request.IdempotencyKey
	if _, err := service.StartIndexData(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if generated != 2 || first == admissions.request.IdempotencyKey {
		t.Fatalf("generated=%d first=%q second=%q", generated, first, admissions.request.IdempotencyKey)
	}
}

func TestStartServiceRejectsInvalidInputBeforeDependencies(t *testing.T) {
	for name, mutate := range map[string]func(*StartRequest){
		"invalid request":                func(request *StartRequest) { request.ProjectID = 0 },
		"toolkit outside current schema": func(request *StartRequest) { request.ToolkitID = math.MaxInt32 + 1 },
	} {
		t.Run(name, func(t *testing.T) {
			resolver := &startResolverStub{inputs: validStartServiceInputs()}
			admissions := &startAdmissionStub{outcome: validStartAdmissionOutcome()}
			service, err := NewStartService(resolver, admissions, func() (string, error) { return "id", nil })
			if err != nil {
				t.Fatal(err)
			}
			request := validStartServiceRequest()
			mutate(&request)
			if _, err := service.StartIndexData(context.Background(), request); !errors.Is(err, ErrInvalidIndexStart) {
				t.Fatalf("error=%v", err)
			}
			if resolver.calls != 0 || admissions.calls != 0 {
				t.Fatal("invalid request crossed a dependency boundary")
			}
		})
	}
}

func TestStartServicePreservesResolverAndAdmissionFailures(t *testing.T) {
	resolverFailure := errors.New("resolver failure")
	resolver := &startResolverStub{err: resolverFailure}
	admissions := &startAdmissionStub{outcome: validStartAdmissionOutcome()}
	service, err := NewStartService(resolver, admissions, func() (string, error) { return "id", nil })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartIndexData(context.Background(), validStartServiceRequest()); !errors.Is(err, resolverFailure) {
		t.Fatalf("resolver error=%v", err)
	}
	if admissions.calls != 0 {
		t.Fatal("resolver failure reached admission")
	}

	admissionFailure := errors.New("admission failure")
	resolver = &startResolverStub{inputs: validStartServiceInputs()}
	admissions = &startAdmissionStub{err: admissionFailure}
	service, err = NewStartService(resolver, admissions, func() (string, error) { return "id", nil })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartIndexData(context.Background(), validStartServiceRequest()); !errors.Is(err, admissionFailure) {
		t.Fatalf("admission error=%v", err)
	}
}

func TestStartServiceFailsClosedOnMissingCorrelationOrInvalidOutcome(t *testing.T) {
	request := validStartServiceRequest()
	request.StreamID = ""
	request.MessageID = ""
	resolver := &startResolverStub{inputs: validStartServiceInputs()}
	admissions := &startAdmissionStub{outcome: validStartAdmissionOutcome()}
	service, err := NewStartService(resolver, admissions, func() (string, error) { return "", nil })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartIndexData(context.Background(), request); err == nil || admissions.calls != 0 {
		t.Fatalf("empty generated correlation error=%v admission calls=%d", err, admissions.calls)
	}

	service, err = NewStartService(resolver, &startAdmissionStub{}, func() (string, error) { return "id", nil })
	if err != nil {
		t.Fatal(err)
	}
	request = validStartServiceRequest()
	if _, err := service.StartIndexData(context.Background(), request); err == nil {
		t.Fatal("invalid durable admission outcome was accepted")
	}
}

func TestNewStartServiceRequiresDependencies(t *testing.T) {
	resolver := &startResolverStub{}
	admissions := &startAdmissionStub{}
	for _, create := range []func() (*StartService, error){
		func() (*StartService, error) {
			return NewStartService(nil, admissions, func() (string, error) { return "id", nil })
		},
		func() (*StartService, error) {
			return NewStartService(resolver, nil, func() (string, error) { return "id", nil })
		},
		func() (*StartService, error) { return NewStartService(resolver, admissions, nil) },
	} {
		if _, err := create(); err == nil {
			t.Fatal("incomplete start service was accepted")
		}
	}
}

func validStartServiceRequest() StartRequest {
	model := "gpt-test"
	return StartRequest{
		ProjectID:            7,
		ActorUserID:          11,
		ToolkitID:            42,
		ToolParameters:       json.RawMessage(`{"index_name":"docs"}`),
		RequestedLLMModel:    &model,
		RequestedLLMSettings: json.RawMessage(`{"temperature":0.1}`),
		StreamID:             "stream-1",
		MessageID:            "message-1",
	}
}

func validStartServiceInputs() AuthoritativeInputs {
	model := "gpt-test"
	return AuthoritativeInputs{
		ToolkitConfiguration: json.RawMessage(`{"id":42,"type":"github"}`),
		ToolParameters:       json.RawMessage(`{"index_name":"docs"}`),
		LLMModel:             &model,
		LLMConfiguration:     json.RawMessage(`{"temperature":0.1}`),
	}
}

func validStartAdmissionOutcome() executionapp.AdmissionOutcome {
	now := time.Date(2026, time.July, 22, 12, 0, 0, 0, time.UTC)
	return executionapp.AdmissionOutcome{
		ExecutionID: "execution-1",
		CommandID:   "command-1",
		AdmittedAt:  now,
		Deadline:    now.Add(time.Hour),
	}
}
