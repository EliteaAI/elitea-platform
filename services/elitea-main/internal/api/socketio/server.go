package socketio

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"

	"github.com/redis/go-redis/v9"
	sio "github.com/zishang520/socket.io/v2/socket"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/conversations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/predict"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/indexersvc"
)

type Server struct {
	io      *sio.Server
	indexer *indexersvc.Client
	rdb     redis.UniversalClient
	rooms   *roomRegistry
}

type Config struct {
	Indexer *indexersvc.Client
	Redis   redis.UniversalClient
}

func NewServer(cfg Config) *Server {
	io := sio.NewServer(nil, nil)

	s := &Server{
		io:      io,
		indexer: cfg.Indexer,
		rdb:     cfg.Redis,
		rooms:   newRoomRegistry(),
	}

	if err := io.On("connection", func(clients ...any) {
		client := clients[0].(*sio.Socket)
		s.registerHandlers(client)
	}); err != nil {
		slog.Error("socketio: failed to register connection handler", "err", err)
	}

	return s
}

func (s *Server) Handler() http.Handler {
	return s.io.ServeHandler(nil)
}

func (s *Server) registerHandlers(client *sio.Socket) {
	// client.On returns an error only if the event name is empty; all names below are constants so errors are logged but non-fatal.
	_ = client.On("chat_enter_room", func(args ...any) {
		s.handleEnterRoom(client, args)
	})

	_ = client.On("chat_leave_rooms", func(args ...any) {
		s.handleLeaveRooms(client, args)
	})

	_ = client.On("chat_predict", func(args ...any) {
		s.handleChatPredict(client, args)
	})

	_ = client.On("chat_continue_predict", func(args ...any) {
		s.handleChatPredict(client, args)
	})

	_ = client.On("application_predict", func(args ...any) {
		s.handleApplicationPredict(client, args)
	})

	_ = client.On("application_continue_message", func(args ...any) {
		s.handleApplicationPredict(client, args)
	})

	_ = client.On("application_leave_rooms", func(args ...any) {
		s.handleLeaveRooms(client, args)
	})

	_ = client.On("promptlib_predict", func(args ...any) {
		s.handleApplicationPredict(client, args)
	})

	_ = client.On("promptlib_leave_rooms", func(args ...any) {
		s.handleLeaveRooms(client, args)
	})

	_ = client.On("chat_canvas_join", func(args ...any) {
		s.handleCanvasJoin(client, args)
	})

	_ = client.On("chat_canvas_edit", func(args ...any) {
		s.handleCanvasEdit(client, args)
	})

	_ = client.On("chat_canvas_leave_rooms", func(args ...any) {
		s.handleLeaveRooms(client, args)
	})

	_ = client.On("test_mcp_connection", func(args ...any) {
		s.handleTestMCP(client, args)
	})

	_ = client.On("disconnect", func(args ...any) {
		s.rooms.removeClient(string(client.Id()))
	})
}

func (s *Server) handleEnterRoom(client *sio.Socket, args []any) {
	if len(args) == 0 {
		return
	}
	data := toMap(args[0])
	room := strVal(data, "room_id")
	if room == "" {
		room = strVal(data, "conversation_id")
	}
	if room == "" {
		return
	}
	client.Join(sio.Room(room))
	s.rooms.addClient(string(client.Id()), room)
}

func (s *Server) handleLeaveRooms(client *sio.Socket, _ []any) {
	rooms := s.rooms.getRooms(string(client.Id()))
	for _, room := range rooms {
		client.Leave(sio.Room(room))
	}
	s.rooms.removeClient(string(client.Id()))
}

func (s *Server) handleChatPredict(client *sio.Socket, args []any) {
	if len(args) == 0 {
		return
	}
	data := toMap(args[0])

	projectID := strVal(data, "project_id")
	conversationID := strVal(data, "conversation_id")
	content := strVal(data, "content")

	room := conversationID
	if room == "" {
		room = strVal(data, "room_id")
	}

	go func() {
		ctx := context.Background()
		req := conversations.SendMessageRequest{
			ProjectID:      projectID,
			ConversationID: conversationID,
			Content:        content,
			Stream:         true,
		}

		err := s.indexer.SendMessageStream(ctx, req, func(evt predict.StreamEvent) error {
			payload := map[string]any{
				"type":    evt.Type,
				"content": evt.Content,
				"done":    evt.Done,
			}
			if room != "" {
				_ = s.io.To(sio.Room(room)).Emit("chat_predict", payload) // fire-and-forget socket write
			} else {
				_ = client.Emit("chat_predict", payload) // fire-and-forget socket write
			}
			return nil
		})
		if err != nil {
			slog.Error("socketio: chat_predict error", "err", err)
			_ = client.Emit("chat_predict", map[string]any{ // fire-and-forget error notification
				"type":    "error",
				"content": err.Error(),
				"done":    true,
			})
		}
	}()
}

func (s *Server) handleApplicationPredict(client *sio.Socket, args []any) {
	if len(args) == 0 {
		return
	}
	data := toMap(args[0])

	projectID := strVal(data, "project_id")
	versionID := strVal(data, "version_id")
	input := strVal(data, "input")

	go func() {
		ctx := context.Background()
		req := predict.Request{
			ProjectID: projectID,
			VersionID: versionID,
			Input:     input,
			Stream:    true,
		}

		err := s.indexer.PredictStream(ctx, req, func(evt predict.StreamEvent) error {
			payload := map[string]any{
				"type":    evt.Type,
				"content": evt.Content,
				"done":    evt.Done,
			}
			_ = client.Emit("application_predict", payload) // fire-and-forget socket write
			return nil
		})
		if err != nil {
			slog.Error("socketio: application_predict error", "err", err)
			_ = client.Emit("application_predict", map[string]any{ // fire-and-forget error notification
				"type":    "error",
				"content": err.Error(),
				"done":    true,
			})
		}
	}()
}

func (s *Server) handleCanvasJoin(client *sio.Socket, args []any) {
	if len(args) == 0 {
		return
	}
	data := toMap(args[0])
	canvasID := strVal(data, "canvas_id")
	if canvasID == "" {
		return
	}
	room := "canvas:" + canvasID
	client.Join(sio.Room(room))
	s.rooms.addClient(string(client.Id()), room)
	_ = s.io.To(sio.Room(room)).Emit("chat_canvas_editor_joined", map[string]any{ // fire-and-forget socket broadcast
		"user_id": data["user_id"],
	})
}

func (s *Server) handleCanvasEdit(client *sio.Socket, args []any) {
	if len(args) == 0 {
		return
	}
	data := toMap(args[0])
	canvasID := strVal(data, "canvas_id")
	if canvasID == "" {
		return
	}
	room := "canvas:" + canvasID
	_ = client.To(sio.Room(room)).Emit("chat_canvas_content_change", data) // fire-and-forget socket broadcast
}

func (s *Server) handleTestMCP(client *sio.Socket, args []any) {
	if len(args) == 0 {
		return
	}
	data := toMap(args[0])

	go func() {
		ctx := context.Background()
		req := predict.Request{
			ProjectID: strVal(data, "project_id"),
			VersionID: strVal(data, "version_id"),
			Input:     strVal(data, "input"),
			Mode:      "test_mcp",
		}
		resp, err := s.indexer.Predict(ctx, req)
		if err != nil {
			_ = client.Emit("test_mcp_connection", map[string]any{ // fire-and-forget error notification
				"type": "error", "content": err.Error(), "done": true,
			})
			return
		}
		_ = client.Emit("test_mcp_connection", map[string]any{ // fire-and-forget socket write
			"type": "result", "content": resp.Content, "done": true,
		})
	}()
}

func strVal(m map[string]any, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	s, ok := v.(string)
	if ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}

func toMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	b, err := json.Marshal(v)
	if err != nil {
		return map[string]any{}
	}
	var result map[string]any
	_ = json.Unmarshal(b, &result) // b was just produced by json.Marshal, so Unmarshal cannot fail
	return result
}

type roomRegistry struct {
	mu      sync.RWMutex
	clients map[string][]string
}

func newRoomRegistry() *roomRegistry {
	return &roomRegistry{clients: make(map[string][]string)}
}

func (r *roomRegistry) addClient(clientID, room string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.clients[clientID] = append(r.clients[clientID], room)
}

func (r *roomRegistry) getRooms(clientID string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.clients[clientID]
}

func (r *roomRegistry) removeClient(clientID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.clients, clientID)
}
