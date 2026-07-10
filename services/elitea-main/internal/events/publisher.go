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
