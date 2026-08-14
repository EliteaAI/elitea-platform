package indexing

import (
	"context"
	"errors"
	"math"
	"strings"
	"unicode/utf8"
)

var (
	ErrInvalidCurrentIndexCancel = errors.New("invalid current index cancel request")
	ErrCurrentIndexCancelFailed  = errors.New("current index cancellation is unavailable")
)

// CurrentIndexCancelRequest identifies one admitted Go index execution. The
// execution ID shape intentionally excludes current Arbiter UUID task IDs so
// the compatibility router can send each task to its owning runtime.
type CurrentIndexCancelRequest struct {
	ProjectID   int64
	ToolkitID   int64
	IndexName   string
	ExecutionID string
}

func (r CurrentIndexCancelRequest) Validate() error {
	if r.ProjectID <= 0 || r.ProjectID > math.MaxInt32 ||
		r.ToolkitID <= 0 || r.ToolkitID > math.MaxInt32 ||
		!validCurrentIndexCancelName(r.IndexName) ||
		!validCurrentIndexExecutionID(r.ExecutionID) {
		return ErrInvalidCurrentIndexCancel
	}
	return nil
}

type CurrentIndexCancellationStore interface {
	RequestCurrentIndexCancellation(context.Context, CurrentIndexCancelRequest) (bool, error)
}

// CurrentIndexCancellationService records cancellation intent only. The
// execution owner observes desired_state and performs fenced settlement and
// external index cleanup; an HTTP request never interrupts worker code.
type CurrentIndexCancellationService struct {
	store CurrentIndexCancellationStore
}

func NewCurrentIndexCancellationService(
	store CurrentIndexCancellationStore,
) (*CurrentIndexCancellationService, error) {
	if store == nil {
		return nil, errors.New("current index cancellation store is required")
	}
	return &CurrentIndexCancellationService{store: store}, nil
}

// Cancel reports whether this call changed the durable desired state. A false
// result is a successful idempotent no-op and is intentionally not an error.
func (s *CurrentIndexCancellationService) Cancel(
	ctx context.Context,
	request CurrentIndexCancelRequest,
) (bool, error) {
	if s == nil || s.store == nil || ctx == nil {
		return false, ErrInvalidCurrentIndexCancel
	}
	if err := request.Validate(); err != nil {
		return false, err
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}

	transitioned, err := s.store.RequestCurrentIndexCancellation(ctx, request)
	if err != nil {
		if contextError := ctx.Err(); contextError != nil {
			return false, contextError
		}
		if errors.Is(err, context.Canceled) {
			return false, context.Canceled
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return false, context.DeadlineExceeded
		}
		return false, ErrCurrentIndexCancelFailed
	}
	return transitioned, nil
}

func validCurrentIndexCancelName(value string) bool {
	length := utf8.RuneCountInString(value)
	return length >= 1 &&
		length <= MaxCurrentIndexNameRunes &&
		utf8.ValidString(value) &&
		strings.TrimSpace(value) != "" &&
		!strings.ContainsAny(value, "\x00\r\n")
}

func validCurrentIndexExecutionID(value string) bool {
	if len(value) != 32 {
		return false
	}
	for index := range value {
		character := value[index]
		if (character < '0' || character > '9') &&
			(character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}
