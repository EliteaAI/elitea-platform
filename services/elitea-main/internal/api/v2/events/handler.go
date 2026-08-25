package events

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	goredis "github.com/redis/go-redis/v9"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
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

// StreamPermission gates the project event stream (#496).
//
// THE LEGACY MATRIX HAS NO ENTRY FOR THIS ROUTE — the reference serves no
// project SSE stream — so this is a proposal, and this is its reason.
//
// The stream is the project's own activity feed. Its declared vocabulary is
// application, skill, folder, conversation and message change notices plus the
// LLM gateway's budget.soft_alert (internal/events/publisher.go), and the only
// publisher a shipped stack actually has today is that soft alert, which carries
// the project's accrued cost. The platform already has a name for "this caller
// may observe this project": `models.project_context.view`. It gates
// GET /api/v2/elitea_core/project_info/{mode}/{projectID}/project-info and every
// project-scoped budget read — /usage/prompt_lib/{projectID}/usage and
// /user_budgets/prompt_lib/{projectID} among them (internal/api/v2/budgets,
// ProjectViewPermission). Putting the live feed of the same cost figures on the
// same string is the choice that leaves no way in through the stream that the
// REST read does not already allow.
//
// It is granted in DEFAULT mode by migrations/shared/0062 to admin, editor and
// viewer, so this route does not answer 403 to every caller on a clean database.
// The legacy matrix gives the same three roles the same string in the default
// mode, so the split is transcribed even though the route is not.
//
// The narrower alternative — one of the notification strings, as
// CurrentNotificationEventsRoute takes `models.notifications.notifications.list`
// for the notification stream — was rejected because this stream is not
// notifications: it carries no notification event and would then be gated on a
// permission that describes none of its payloads.
const StreamPermission = "models.project_context.view"

type Handler struct {
	source EventSource
	// permissionResolver gates Stream. nil answers 403 — see require below.
	permissionResolver auth.PermissionResolver
}

// Option configures a Handler. Same shape as the other v2 packages'.
type Option func(*Handler)

// WithPermissionResolver supplies the resolver the stream is gated on. Without
// it the route answers 403, which is the safe direction: the stream is another
// tenant's live event bus.
func WithPermissionResolver(resolver auth.PermissionResolver) Option {
	return func(h *Handler) { h.permissionResolver = resolver }
}

// NewHandler wraps a raw *goredis.Client for the Redis transport (preserves the
// existing call site). NewHandlerFromSource takes any EventSource (used for the
// NATS transport).
func NewHandler(rdb *goredis.Client, opts ...Option) *Handler {
	return newHandler(&redisSource{client: rdb}, opts...)
}

// NewHandlerFromSource builds the handler over an explicit EventSource (e.g. the
// NATS EventBus), used when the platform EventBus is re-pointed to NATS.
func NewHandlerFromSource(src EventSource, opts ...Option) *Handler {
	return newHandler(src, opts...)
}

func newHandler(src EventSource, opts ...Option) *Handler {
	h := &Handler{source: src}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

// Routes returns the SSE subrouter. router.go mounts it at
// "/events/prompt_lib/{projectID}", so `{projectID}` is a segment of the MOUNT
// pattern and chi carries it into this subrouter's route context.
//
// It applied no gate at all until #496. Stream subscribes to
// events.ProjectChannel(projectID) straight from that segment, so any
// authenticated caller could read any tenant's live event bus.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.With(h.require(StreamPermission)).Get("/", h.Stream)
	return r
}

// require gates the stream on the named permission, resolved in DEFAULT mode
// against the `{projectID}` the mount pattern supplies. Fail-closed by
// construction: RequireResolvedPermissionsForProject answers 403 on a nil
// resolver, and legacyrbac refuses a project id that is not a positive integer
// before the handler runs.
//
// The gate is applied at the ROUTE, not inside Stream, so the refusal is a plain
// 403 with no response body started. A check inside the handler would have to
// run after ssewriter.New had already taken over the connection.
func (h *Handler) require(permission string) func(http.Handler) http.Handler {
	return apimw.RequireResolvedPermissions(
		h.permissionResolver,
		auth.PermissionModeDefault,
		permission,
	)
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
