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

// SoftAlertPayload is the soft-alert event body published by elitea-llm-gateway
// on gateway.events.project.<id>.events (design §8.3). The normative contract
// is implemented in services/elitea-llm-gateway/internal/llmproxy/budget_gate.go
// (softAlertPayload struct). Subscribers receive it within a softAlertEnvelope
// (type, source, payload, timestamp). All cost values are int64 nano-USD to
// maintain parity with the NATS governance counters and avoid floating-point
// precision loss.
type SoftAlertPayload struct {
	ProjectID          string `json:"project_id"`
	Scope              string `json:"scope"`
	PeriodStartUnix    int64  `json:"period_start_unix"`
	CostJustBilledNano int64  `json:"cost_just_billed_nano"`

	// Deprecated/historical fields from an earlier design (issue #16):
	// These fields were in the original spec but never implemented in the gateway.
	// Kept as reference for context. DO NOT use these in new code.
	// EventType       string  `json:"event_type"`         // now in envelope.Type
	// OrgID           string  `json:"org_id"`              // never emitted by gateway
	// ThresholdPct    int     `json:"threshold_pct"`       // implicit in business logic
	// AccumulatedCost float64 `json:"accumulated_cost"`   // changed to CostJustBilledNano (int64)
	// Limit           float64 `json:"limit"`               // never emitted by gateway
	// Timestamp       string  `json:"timestamp"`           // now in envelope.Timestamp (time.Time)
}
