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

	"github.com/go-chi/chi/v5"
)

const (
	defaultReplayBatchSize = 100
	maxSSEEventBytes       = 64 * 1024
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
	authorizer EventAuthorizer
	repository EventRepository
	waiter     ReplayWaiter
	batchSize  int
}

func NewEventHandler(authorizer EventAuthorizer, repository EventRepository, waiter ReplayWaiter) (*EventHandler, error) {
	if authorizer == nil || repository == nil || waiter == nil {
		return nil, errors.New("event authorizer, repository and waiter are required")
	}
	return &EventHandler{
		authorizer: authorizer,
		repository: repository,
		waiter:     waiter,
		batchSize:  defaultReplayBatchSize,
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

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	if len(initial) == 0 {
		if _, err := fmt.Fprint(w, ": connected\n\n"); err != nil {
			return
		}
		flusher.Flush()
	}

	events := initial
	for {
		for _, event := range events {
			if event.Cursor <= cursor || validateDurableEvent(event) != nil {
				return
			}
			if err := writeDurableEvent(w, event); err != nil {
				return
			}
			cursor = event.Cursor
		}
		if len(events) > 0 {
			flusher.Flush()
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
		if heartbeat {
			if _, err := fmt.Fprint(w, ": heartbeat\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
		events, err = h.repository.Replay(r.Context(), projectID, executionID, cursor, h.batchSize)
		if err != nil {
			return
		}
	}
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
