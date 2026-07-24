package events

import (
	"context"
	"fmt"
	"log/slog"
)

const (
	EventApplicationCreated = "application.created"
	EventApplicationUpdated = "application.updated"
	EventApplicationDeleted = "application.deleted"

	EventSkillCreated = "skill.created"
	EventSkillUpdated = "skill.updated"
	EventSkillDeleted = "skill.deleted"

	EventFolderCreated = "folder.created"
	EventFolderUpdated = "folder.updated"
	EventFolderDeleted = "folder.deleted"

	EventConversationCreated = "conversation.created"
	EventConversationUpdated = "conversation.updated"
	EventConversationDeleted = "conversation.deleted"

	EventMessageCreated = "message.created"

	// EventBudgetSoftAlert is the LLM-gateway 80%-threshold soft-alert event
	// (design §8.3). It flows on the gateway.events.* subject when the NATS
	// EventBus (internal/infra/natsbus) is wired; the gateway emits it and
	// elitea-main subscribers (and the project SSE stream) receive it.
	EventBudgetSoftAlert = "budget.soft_alert"
)

type Bus interface {
	Publish(ctx context.Context, channel string, eventType string, payload interface{}) error
}

type Publisher struct {
	bus Bus
}

func NewPublisher(bus Bus) *Publisher {
	return &Publisher{bus: bus}
}

func (p *Publisher) Emit(ctx context.Context, projectID, eventType string, payload any) {
	channel := ProjectChannel(projectID)
	if err := p.bus.Publish(ctx, channel, eventType, payload); err != nil {
		slog.Error("events: publish failed", "type", eventType, "project", projectID, "err", err)
	}
}

func ProjectChannel(projectID string) string {
	return fmt.Sprintf("project:%s:events", projectID)
}

type DomainEvent struct {
	ProjectID  string `json:"project_id"`
	EntityID   string `json:"entity_id"`
	EntityType string `json:"entity_type"`
	Action     string `json:"action"`
}

// SoftAlertPayload is the normative soft-alert event body (design §8.3):
// "{event_type, org_id, project_id, scope, threshold_pct, accumulated_cost,
// limit, timestamp}". The gateway publishes it on gateway.events.* when
// accumulated_cost/limit crosses the configured threshold (default 80%). Cost
// fields are USD (the human-facing denomination), not the int64 nano-USD used
// on the enforcement counter path. ProjectID is also the top-level key the
// webhook dispatcher reads to fan out per-project webhooks, so it is included
// both in this typed payload and via the enclosing event's routing subject.
type SoftAlertPayload struct {
	EventType       string  `json:"event_type"`
	OrgID           string  `json:"org_id"`
	ProjectID       string  `json:"project_id"`
	Scope           string  `json:"scope"`
	ThresholdPct    int     `json:"threshold_pct"`
	AccumulatedCost float64 `json:"accumulated_cost"`
	Limit           float64 `json:"limit"`
	Timestamp       string  `json:"timestamp"`
}
