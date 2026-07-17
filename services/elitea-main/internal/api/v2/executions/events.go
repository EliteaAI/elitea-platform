package executions

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const (
	defaultReplayBatchSize = 100
	maxSSEEventBytes       = 64 * 1024
	defaultSSEWriteTimeout = 10 * time.Second
)

var (
	ErrExecutionEventsForbidden = errors.New("execution events are forbidden")
	ErrCursorExpired            = errors.New("execution event cursor expired")
	ErrInvalidEventStream       = errors.New("invalid durable execution event stream")
)

type DurableEvent struct {
	Cursor uint64
	Type   string
	Data   json.RawMessage
}

type EventRepository interface {
	Replay(ctx context.Context, projectID, executionID string, afterCursor uint64, limit int) ([]DurableEvent, error)
}

// ReplayWaiter is only a bounded wakeup/heartbeat mechanism. A wake carries no
// payload and is never authoritative; the handler always replays from the
// durable repository after it returns.
type ReplayWaiter interface {
	Wait(ctx context.Context, projectID, executionID string, afterCursor uint64) (heartbeat bool, err error)
}

type EventAuthorizer interface {
	AuthorizeExecutionEvents(ctx context.Context, projectID, executionID string) error
}

type EventHandler struct {
	authorizer   EventAuthorizer
	repository   EventRepository
	waiter       ReplayWaiter
	batchSize    int
	writeTimeout time.Duration
	admission    *sseAdmissionGate
}

func NewEventHandler(authorizer EventAuthorizer, repository EventRepository, waiter ReplayWaiter) (*EventHandler, error) {
	if authorizer == nil || repository == nil || waiter == nil {
		return nil, errors.New("event authorizer, repository and waiter are required")
	}
	admission := newSSEAdmissionGate(
		defaultMaxActiveSSEStreams,
		defaultMaxActiveSSEStreamsPerPrincipal,
		defaultMaxActiveSSEStreamsPerProject,
	)
	if admission == nil {
		return nil, errors.New("event stream admission profile is invalid")
	}
	return &EventHandler{
		authorizer:   authorizer,
		repository:   repository,
		waiter:       waiter,
		batchSize:    defaultReplayBatchSize,
		writeTimeout: defaultSSEWriteTimeout,
		admission:    admission,
	}, nil
}

func (h *EventHandler) Stream(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	executionID := chi.URLParam(r, "executionID")
	if projectID == "" || executionID == "" {
		http.Error(w, "project and execution are required", http.StatusBadRequest)
		return
	}
	if err := h.authorizer.AuthorizeExecutionEvents(r.Context(), projectID, executionID); err != nil {
		if errors.Is(err, ErrExecutionEventsForbidden) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		http.Error(w, "authorization failed", http.StatusInternalServerError)
		return
	}
	release, admitted := h.admission.acquire(ssePrincipalID(r.Context()), projectID)
	if !admitted {
		w.Header().Set("Retry-After", "2")
		http.Error(w, "too many active event streams", http.StatusTooManyRequests)
		return
	}
	defer release()

	cursor, err := requestedCursor(r)
	if err != nil {
		http.Error(w, "invalid event cursor", http.StatusBadRequest)
		return
	}
	initial, err := h.repository.Replay(r.Context(), projectID, executionID, cursor, h.batchSize)
	if err != nil {
		if errors.Is(err, ErrCursorExpired) {
			http.Error(w, "event cursor expired", http.StatusConflict)
			return
		}
		http.Error(w, "event replay failed", http.StatusInternalServerError)
		return
	}

	stream, err := newBoundedSSEWriter(w, h.writeTimeout)
	if err != nil {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	if err := stream.writeAndFlush(func() error {
		w.WriteHeader(http.StatusOK)
		if len(initial) == 0 {
			_, err := fmt.Fprint(w, ": connected\n\n")
			return err
		}
		return nil
	}); err != nil {
		return
	}

	events := initial
	for {
		if len(events) > 0 {
			if err := stream.writeAndFlush(func() error {
				for _, event := range events {
					if event.Cursor <= cursor || validateDurableEvent(event) != nil {
						return ErrInvalidEventStream
					}
					if err := writeDurableEvent(w, event); err != nil {
						return err
					}
					cursor = event.Cursor
				}
				return nil
			}); err != nil {
				return
			}
		}

		if len(events) == h.batchSize {
			events, err = h.repository.Replay(r.Context(), projectID, executionID, cursor, h.batchSize)
			if err != nil {
				return
			}
			continue
		}

		heartbeat, err := h.waiter.Wait(r.Context(), projectID, executionID, cursor)
		if err != nil {
			return
		}
		// Project suspension or role revocation must close an already-open stream.
		// The production waiter bounds this reauthorization window to two seconds.
		if err := h.authorizer.AuthorizeExecutionEvents(r.Context(), projectID, executionID); err != nil {
			return
		}
		if heartbeat {
			if err := stream.writeAndFlush(func() error {
				_, writeErr := fmt.Fprint(w, ": heartbeat\n\n")
				return writeErr
			}); err != nil {
				return
			}
		}
		events, err = h.repository.Replay(r.Context(), projectID, executionID, cursor, h.batchSize)
		if err != nil {
			return
		}
	}
}

type boundedSSEWriter struct {
	controller *http.ResponseController
	timeout    time.Duration
}

func newBoundedSSEWriter(response http.ResponseWriter, timeout time.Duration) (*boundedSSEWriter, error) {
	if response == nil || timeout <= 0 {
		return nil, errors.New("bounded SSE writer configuration is invalid")
	}
	if !supportsResponseFlush(response) {
		return nil, errors.New("SSE response does not support flushing")
	}
	controller := http.NewResponseController(response)
	// Clear the public server's request-wide WriteTimeout before streaming.
	// Every actual write below installs its own short deadline and clears it
	// after the flush, so an idle but healthy SSE connection remains long-lived.
	if err := controller.SetWriteDeadline(time.Time{}); err != nil {
		return nil, fmt.Errorf("clear inherited SSE write deadline: %w", err)
	}
	return &boundedSSEWriter{controller: controller, timeout: timeout}, nil
}

func supportsResponseFlush(response http.ResponseWriter) bool {
	for depth := 0; depth < 16 && response != nil; depth++ {
		if _, ok := response.(interface{ FlushError() error }); ok {
			return true
		}
		if _, ok := response.(http.Flusher); ok {
			return true
		}
		unwrapper, ok := response.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			return false
		}
		next := unwrapper.Unwrap()
		if next == response {
			return false
		}
		response = next
	}
	return false
}

func (w *boundedSSEWriter) writeAndFlush(write func() error) error {
	if write == nil {
		return errors.New("SSE write is required")
	}
	if err := w.controller.SetWriteDeadline(time.Now().Add(w.timeout)); err != nil {
		return err
	}
	writeErr := write()
	flushErr := w.controller.Flush()
	clearErr := w.controller.SetWriteDeadline(time.Time{})
	return errors.Join(writeErr, flushErr, clearErr)
}

func requestedCursor(r *http.Request) (uint64, error) {
	header := strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	query := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if header != "" && query != "" && header != query {
		return 0, errors.New("conflicting event cursors")
	}
	value := header
	if value == "" {
		value = query
	}
	if value == "" {
		return 0, nil
	}
	return strconv.ParseUint(value, 10, 64)
}

func validateDurableEvent(event DurableEvent) error {
	if event.Cursor == 0 || event.Type == "" || strings.ContainsAny(event.Type, "\r\n") || len(event.Data) == 0 || len(event.Data) > maxSSEEventBytes || !json.Valid(event.Data) {
		return ErrInvalidEventStream
	}
	return nil
}

func writeDurableEvent(w http.ResponseWriter, event DurableEvent) error {
	var compact bytes.Buffer
	if err := json.Compact(&compact, event.Data); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "id: %d\nevent: %s\ndata: ", event.Cursor, event.Type); err != nil {
		return err
	}
	if _, err := w.Write(compact.Bytes()); err != nil {
		return err
	}
	_, err := fmt.Fprint(w, "\n\n")
	return err
}
