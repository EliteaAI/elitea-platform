package indexing

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"
)

func TestCurrentIndexCancelRequestValidatesCurrentGoExecutionIdentity(t *testing.T) {
	t.Parallel()

	valid := CurrentIndexCancelRequest{
		ProjectID:   7,
		ToolkitID:   9,
		IndexName:   "documents",
		ExecutionID: "0123456789abcdef0123456789abcdef",
	}
	if err := valid.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}

	tests := map[string]CurrentIndexCancelRequest{
		"missing project":       withCurrentIndexCancel(valid, func(request *CurrentIndexCancelRequest) { request.ProjectID = 0 }),
		"project exceeds int32": withCurrentIndexCancel(valid, func(request *CurrentIndexCancelRequest) { request.ProjectID = math.MaxInt32 + 1 }),
		"missing toolkit":       withCurrentIndexCancel(valid, func(request *CurrentIndexCancelRequest) { request.ToolkitID = 0 }),
		"toolkit exceeds int32": withCurrentIndexCancel(valid, func(request *CurrentIndexCancelRequest) { request.ToolkitID = math.MaxInt32 + 1 }),
		"blank index":           withCurrentIndexCancel(valid, func(request *CurrentIndexCancelRequest) { request.IndexName = " \t" }),
		"long index": withCurrentIndexCancel(valid, func(request *CurrentIndexCancelRequest) {
			request.IndexName = strings.Repeat("x", MaxCurrentIndexNameRunes+1)
		}),
		"unsafe index":        withCurrentIndexCancel(valid, func(request *CurrentIndexCancelRequest) { request.IndexName = "docs\nnext" }),
		"arbiter UUID":        withCurrentIndexCancel(valid, func(request *CurrentIndexCancelRequest) { request.ExecutionID = "01234567-89ab-cdef-0123-456789abcdef" }),
		"uppercase execution": withCurrentIndexCancel(valid, func(request *CurrentIndexCancelRequest) { request.ExecutionID = "0123456789ABCDEF0123456789abcdef" }),
		"short execution":     withCurrentIndexCancel(valid, func(request *CurrentIndexCancelRequest) { request.ExecutionID = "0123456789abcdef" }),
		"non-hex execution":   withCurrentIndexCancel(valid, func(request *CurrentIndexCancelRequest) { request.ExecutionID = "g123456789abcdef0123456789abcdef" }),
	}
	for name, request := range tests {
		request := request
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if err := request.Validate(); !errors.Is(err, ErrInvalidCurrentIndexCancel) {
				t.Fatalf("Validate() error = %v, want %v", err, ErrInvalidCurrentIndexCancel)
			}
		})
	}
}

func TestCurrentIndexCancellationServicePreservesNoTransitionAndFailureSemantics(t *testing.T) {
	t.Parallel()

	request := CurrentIndexCancelRequest{
		ProjectID:   7,
		ToolkitID:   9,
		IndexName:   "documents",
		ExecutionID: "0123456789abcdef0123456789abcdef",
	}
	for name, test := range map[string]struct {
		storeResult bool
		storeError  error
		wantResult  bool
		wantError   error
	}{
		"transition":         {storeResult: true, wantResult: true},
		"no transition":      {},
		"store failure":      {storeError: errors.New("database detail"), wantError: ErrCurrentIndexCancelFailed},
		"store timeout":      {storeError: context.DeadlineExceeded, wantError: context.DeadlineExceeded},
		"store cancellation": {storeError: context.Canceled, wantError: context.Canceled},
	} {
		name, test := name, test
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			store := &currentIndexCancelStoreStub{result: test.storeResult, err: test.storeError}
			service, err := NewCurrentIndexCancellationService(store)
			if err != nil {
				t.Fatal(err)
			}
			result, err := service.Cancel(context.Background(), request)
			if result != test.wantResult || !errors.Is(err, test.wantError) {
				t.Fatalf("Cancel() = %v, %v; want %v, %v", result, err, test.wantResult, test.wantError)
			}
			if store.calls != 1 || store.request != request {
				t.Fatalf("store calls=%d request=%+v", store.calls, store.request)
			}
		})
	}
}

func TestCurrentIndexCancellationServiceRejectsBeforeStore(t *testing.T) {
	t.Parallel()

	store := &currentIndexCancelStoreStub{}
	service, err := NewCurrentIndexCancellationService(store)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Cancel(context.Background(), CurrentIndexCancelRequest{}); !errors.Is(err, ErrInvalidCurrentIndexCancel) {
		t.Fatalf("Cancel() error = %v", err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	valid := CurrentIndexCancelRequest{
		ProjectID:   7,
		ToolkitID:   9,
		IndexName:   "documents",
		ExecutionID: "0123456789abcdef0123456789abcdef",
	}
	if _, err := service.Cancel(cancelled, valid); !errors.Is(err, context.Canceled) {
		t.Fatalf("Cancel(cancelled) error = %v", err)
	}
	if store.calls != 0 {
		t.Fatalf("invalid requests reached store %d times", store.calls)
	}
}

func withCurrentIndexCancel(
	request CurrentIndexCancelRequest,
	mutate func(*CurrentIndexCancelRequest),
) CurrentIndexCancelRequest {
	mutate(&request)
	return request
}

type currentIndexCancelStoreStub struct {
	request CurrentIndexCancelRequest
	result  bool
	err     error
	calls   int
}

func (s *currentIndexCancelStoreStub) RequestCurrentIndexCancellation(
	_ context.Context,
	request CurrentIndexCancelRequest,
) (bool, error) {
	s.calls++
	s.request = request
	return s.result, s.err
}
