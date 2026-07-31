package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var ErrNotificationNotFound = errors.New("notification not found")

// Notification preserves the current centry.notifications data contract. It is
// intentionally generic: producers may use any event type and metadata shape.
type Notification struct {
	ID        int32
	UUID      string
	IsSeen    bool
	ProjectID int32
	UserID    int32
	Meta      json.RawMessage
	EventType string
	CreatedAt time.Time
	UpdatedAt *time.Time
}

type ListFilter struct {
	OnlyNew     bool
	SearchWords []string
	EventType   string
	SortBy      string
	SortOrder   string
	Limit       int32
	Offset      int32
}

// Store is user-scoped for every operation. The project in the HTTP route is
// authorization context; current notification ownership is global per user.
type Store interface {
	Count(context.Context, int64, ListFilter) (int64, error)
	List(context.Context, int64, ListFilter) ([]Notification, error)
	Get(context.Context, int64, int64) (Notification, error)
	MarkSeen(context.Context, int64, int64) (Notification, error)
	Delete(context.Context, int64, int64) error
	BulkSetSeen(context.Context, int64, []int64, bool, bool) (int64, error)
	BulkDelete(context.Context, int64, []int64) (int64, error)
}
