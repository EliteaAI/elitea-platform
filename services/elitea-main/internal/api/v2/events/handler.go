package events

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	goredis "github.com/redis/go-redis/v9"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/events"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/redis"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/ssewriter"
)

// EventSource is the transport-agnostic seam the SSE handler consumes. It yields
// decoded redis.Event values on the given channel until the caller invokes the
// returned cancel func or the request context is cancelled. Both transports
// implement it: the NATS EventBus (internal/infra/natsbus.EventBus.Raw) and the
// Redis adapter (redisSource) below. This keeps the project SSE stream on the
// same transport as the rest of the EventBus so re-pointing to NATS does not
// split event delivery.
type EventSource interface {
	Raw(ctx context.Context, channel string) (<-chan redis.Event, func(), error)
}

type Handler struct {
	source EventSource
}

// NewHandler wraps a raw *goredis.Client for the Redis transport (preserves the
// existing call site). NewHandlerFromSource takes any EventSource (used for the
// NATS transport).
func NewHandler(rdb *goredis.Client) *Handler {
	return &Handler{source: &redisSource{client: rdb}}
}

// NewHandlerFromSource builds the handler over an explicit EventSource (e.g. the
// NATS EventBus), used when the platform EventBus is re-pointed to NATS.
func NewHandlerFromSource(src EventSource) *Handler {
	return &Handler{source: src}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.Stream)
	return r
}

func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	channel := events.ProjectChannel(projectID)

	sse, err := ssewriter.New(w)
	if err != nil {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	ctx := r.Context()
	evCh, cancel, err := h.source.Raw(ctx, channel)
	if err != nil {
		http.Error(w, "event source unavailable", http.StatusInternalServerError)
		return
	}
	defer cancel()

	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	_ = sse.Comment("connected")

	for {
		select {
		case <-ctx.Done():
			return
		case evt, ok := <-evCh:
			if !ok {
				return
			}
			_ = sse.Event(evt.Type, string(evt.Payload))
		case <-heartbeat.C:
			if err := sse.Comment("heartbeat"); err != nil {
				return
			}
		}
	}
}

// redisSource adapts a *goredis.Client to EventSource, preserving the original
// Redis pub/sub subscription behaviour (decode the {type,payload} envelope).
type redisSource struct {
	client *goredis.Client
}

func (rs *redisSource) Raw(ctx context.Context, channel string) (<-chan redis.Event, func(), error) {
	sub := rs.client.Subscribe(ctx, channel)
	out := make(chan redis.Event, 64)
	done := make(chan struct{})
	cancel := func() {
		select {
		case <-done:
		default:
			close(done)
		}
	}

	go func() {
		defer close(out)
		defer func() { _ = sub.Close() }()
		ch := sub.Channel()
		for {
			select {
			case <-ctx.Done():
				return
			case <-done:
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				var evt redis.Event
				if err := json.Unmarshal([]byte(msg.Payload), &evt); err != nil {
					continue
				}
				select {
				case out <- evt:
				case <-ctx.Done():
					return
				case <-done:
					return
				}
			}
		}
	}()

	return out, cancel, nil
}
