package events

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	goredis "github.com/redis/go-redis/v9"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/events"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/ssewriter"
)

type Handler struct {
	redis *goredis.Client
}

func NewHandler(redis *goredis.Client) *Handler {
	return &Handler{redis: redis}
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
	sub := h.redis.Subscribe(ctx, channel)
	defer func() { _ = sub.Close() }()

	ch := sub.Channel()

	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	_ = sse.Comment("connected")

	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var evt struct {
				Type string          `json:"type"`
				Data json.RawMessage `json:"payload"`
			}
			if err := json.Unmarshal([]byte(msg.Payload), &evt); err != nil {
				continue
			}
			_ = sse.Event(evt.Type, string(evt.Data))
		case <-heartbeat.C:
			if err := sse.Comment("heartbeat"); err != nil {
				return
			}
		}
	}
}
