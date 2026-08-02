package notifications

import (
	"context"
	"encoding/json"
	"time"
)

// Event is the durable current-platform notification projected to the browser.
// Cursor is transport metadata; the remaining fields preserve the current
// notifications_notify Socket.IO payload.
type Event struct {
	Cursor    int64
	UUID      string
	IsSeen    bool
	ProjectID int32
	UserID    int32
	Meta      json.RawMessage
	EventType string
	CreatedAt time.Time
	UpdatedAt *time.Time
}

// EventReader is user-scoped because the current notification stream and list
// are user-global. The project in the HTTP path remains the RBAC context.
type EventReader interface {
	HighWater(context.Context, int64) (int64, error)
	ListAfter(context.Context, int64, int64, int32) ([]Event, error)
}
