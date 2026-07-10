package repos

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/conversations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type ConversationsRepo struct {
	pool *pgxpool.Pool
}

func NewConversationsRepo(pool *pgxpool.Pool) *ConversationsRepo {
	return &ConversationsRepo{pool: pool}
}

func (r *ConversationsRepo) List(ctx context.Context, projectID string, page, pageSize int) (conversations.ListResponse, error) {
	s := schema(projectID)

	var total int
	countQ := fmt.Sprintf(`SELECT COUNT(*) FROM %q.chat_conversations`, s)
	if err := r.pool.QueryRow(ctx, countQ).Scan(&total); err != nil {
		return conversations.ListResponse{Items: []conversations.Conversation{}, Total: 0, Page: page, PageSize: pageSize}, nil
	}

	offset := (page - 1) * pageSize
	q := fmt.Sprintf(`
		SELECT c.id, c.name, COALESCE(c.uuid::text, ''), c.author_id, c.created_at, c.updated_at,
			(SELECT COUNT(*) FROM %q.chat_message_group mg WHERE mg.conversation_id = c.id)
		FROM %q.chat_conversations c
		ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
		LIMIT $1 OFFSET $2`, s, s)

	rows, err := r.pool.Query(ctx, q, pageSize, offset)
	if err != nil {
		return conversations.ListResponse{Items: []conversations.Conversation{}, Total: 0, Page: page, PageSize: pageSize}, nil
	}
	defer rows.Close()

	var items []conversations.Conversation
	for rows.Next() {
		var c conversations.Conversation
		var authorID int
		rows.Scan(&c.ID, &c.Name, &c.Description, &authorID, &c.CreatedAt, &c.UpdatedAt, &c.MessageCount)
		c.ProjectID = projectID
		c.CreatedBy = fmt.Sprintf("%d", authorID)
		items = append(items, c)
	}
	if items == nil {
		items = []conversations.Conversation{}
	}

	totalPages := total / pageSize
	if total%pageSize > 0 {
		totalPages++
	}

	return conversations.ListResponse{
		Items:      items,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func (r *ConversationsRepo) Get(ctx context.Context, projectID, conversationID string) (conversations.Conversation, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`
		SELECT c.id, c.name, COALESCE(c.uuid::text, ''), c.author_id, c.created_at, c.updated_at,
			(SELECT COUNT(*) FROM %q.chat_message_group mg WHERE mg.conversation_id = c.id)
		FROM %q.chat_conversations c WHERE c.id = $1`, s, s)

	var c conversations.Conversation
	var authorID int
	err := r.pool.QueryRow(ctx, q, conversationID).Scan(
		&c.ID, &c.Name, &c.Description, &authorID, &c.CreatedAt, &c.UpdatedAt, &c.MessageCount,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return conversations.Conversation{}, apierr.NotFound("conversation not found")
		}
		return conversations.Conversation{}, fmt.Errorf("conversations: get: %w", err)
	}
	c.ProjectID = projectID
	c.CreatedBy = fmt.Sprintf("%d", authorID)
	return c, nil
}

func (r *ConversationsRepo) Create(ctx context.Context, projectID string, conv conversations.Conversation) (conversations.Conversation, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`
		INSERT INTO %q.chat_conversations (name, author_id, is_private)
		VALUES ($1, 1, true)
		RETURNING id, name, uuid::text, created_at, updated_at`, s)

	var c conversations.Conversation
	err := r.pool.QueryRow(ctx, q, conv.Name).Scan(&c.ID, &c.Name, &c.Description, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return conversations.Conversation{}, fmt.Errorf("conversations: create: %w", err)
	}
	c.ProjectID = projectID
	c.CreatedBy = "1"
	return c, nil
}

func (r *ConversationsRepo) Update(ctx context.Context, projectID, conversationID string, conv conversations.Conversation) (conversations.Conversation, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`
		UPDATE %q.chat_conversations SET name = $1, updated_at = now()
		WHERE id = $2
		RETURNING id, name, COALESCE(uuid::text, ''), created_at, updated_at`, s)

	var c conversations.Conversation
	err := r.pool.QueryRow(ctx, q, conv.Name, conversationID).Scan(
		&c.ID, &c.Name, &c.Description, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return conversations.Conversation{}, apierr.NotFound("conversation not found")
		}
		return conversations.Conversation{}, fmt.Errorf("conversations: update: %w", err)
	}
	c.ProjectID = projectID
	return c, nil
}

func (r *ConversationsRepo) Delete(ctx context.Context, projectID, conversationID string) error {
	s := schema(projectID)
	q := fmt.Sprintf(`DELETE FROM %q.chat_conversations WHERE id = $1`, s)
	ct, err := r.pool.Exec(ctx, q, conversationID)
	if err != nil {
		return fmt.Errorf("conversations: delete: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return apierr.NotFound("conversation not found")
	}
	return nil
}

func (r *ConversationsRepo) AddParticipant(ctx context.Context, projectID, conversationID string, body map[string]any) error {
	s := schema(projectID)
	entityName, _ := body["entity_name"].(string)
	entityMeta, _ := json.Marshal(body["entity_meta"])

	// Insert participant (schema: id, uuid, entity_name, entity_meta, meta)
	q := fmt.Sprintf(`INSERT INTO %q.chat_participants (entity_name, entity_meta) VALUES ($1, $2::jsonb) RETURNING id`, s)
	var participantID int
	err := r.pool.QueryRow(ctx, q, entityName, entityMeta).Scan(&participantID)
	if err != nil {
		// May already exist, try to find it
		q2 := fmt.Sprintf(`SELECT id FROM %q.chat_participants WHERE entity_name = $1`, s)
		r.pool.QueryRow(ctx, q2, entityName).Scan(&participantID)
	}

	// Map participant to conversation (schema: id, conversation_id, participant_id, entity_settings, created_at, updated_at)
	q3 := fmt.Sprintf(`INSERT INTO %q.chat_participant_mapping (conversation_id, participant_id) VALUES ($1, $2) ON CONFLICT ON CONSTRAINT _participant_conversation_uc DO NOTHING`, s)
	r.pool.Exec(ctx, q3, conversationID, participantID)
	return nil
}

func (r *ConversationsRepo) RemoveParticipant(ctx context.Context, projectID, conversationID, participantID string) error {
	s := schema(projectID)
	q := fmt.Sprintf(`DELETE FROM %q.chat_participant_mapping WHERE conversation_id = $1 AND participant_id = $2`, s)
	r.pool.Exec(ctx, q, conversationID, participantID)
	return nil
}

func (r *ConversationsRepo) UpdateEntitySettings(ctx context.Context, projectID, conversationID, participantID string, settings map[string]any) error {
	s := schema(projectID)
	data, _ := json.Marshal(settings)
	q := fmt.Sprintf(`UPDATE %q.chat_participant_mapping SET entity_settings = $1 WHERE conversation_id = $2 AND participant_id = $3`, s)
	r.pool.Exec(ctx, q, data, conversationID, participantID)
	return nil
}

func (r *ConversationsRepo) BatchUpdateEntitySettings(ctx context.Context, projectID, conversationID string, settings []map[string]any) error {
	for _, s := range settings {
		pid, _ := s["participant_id"].(string)
		delete(s, "participant_id")
		r.UpdateEntitySettings(ctx, projectID, conversationID, pid, s)
	}
	return nil
}

func (r *ConversationsRepo) SelectConversation(ctx context.Context, projectID, conversationID, userID string) error {
	s := schema(projectID)
	// Schema: id, user_id, conversation_id (no unique on user_id, so delete+insert)
	delQ := fmt.Sprintf(`DELETE FROM %q.chat_selected_conversations WHERE user_id = $1`, s)
	r.pool.Exec(ctx, delQ, userID)
	insQ := fmt.Sprintf(`INSERT INTO %q.chat_selected_conversations (conversation_id, user_id) VALUES ($1, $2)`, s)
	r.pool.Exec(ctx, insQ, conversationID, userID)
	return nil
}

func (r *ConversationsRepo) DeselectConversation(ctx context.Context, projectID, userID string) error {
	s := schema(projectID)
	q := fmt.Sprintf(`DELETE FROM %q.chat_selected_conversations WHERE user_id = $1`, s)
	r.pool.Exec(ctx, q, userID)
	return nil
}

func (r *ConversationsRepo) CreateCanvas(ctx context.Context, projectID string, body map[string]any) (map[string]any, error) {
	s := schema(projectID)
	name, _ := body["name"].(string)
	q := fmt.Sprintf(`INSERT INTO %q.chat_conversations (name, author_id, is_private, meta) VALUES ($1, 1, true, '{"type":"canvas"}') RETURNING id, name, created_at`, s)
	var id string
	var rname string
	var createdAt time.Time
	if err := r.pool.QueryRow(ctx, q, name).Scan(&id, &rname, &createdAt); err != nil {
		return nil, fmt.Errorf("create canvas: %w", err)
	}
	return map[string]any{"id": id, "name": rname, "conversations": []any{}, "created_at": createdAt}, nil
}

func (r *ConversationsRepo) GetCanvas(ctx context.Context, projectID, canvasID string) (map[string]any, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`SELECT id, name, created_at FROM %q.chat_conversations WHERE id = $1`, s)
	var id, name string
	var createdAt time.Time
	if err := r.pool.QueryRow(ctx, q, canvasID).Scan(&id, &name, &createdAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, apierr.NotFound("canvas not found")
		}
		return nil, fmt.Errorf("get canvas: %w", err)
	}
	return map[string]any{"id": id, "name": name, "conversations": []any{}, "created_at": createdAt}, nil
}

func (r *ConversationsRepo) UpdateCanvas(ctx context.Context, projectID, canvasID string, body map[string]any) error {
	s := schema(projectID)
	name, _ := body["name"].(string)
	q := fmt.Sprintf(`UPDATE %q.chat_conversations SET name = $1, updated_at = now() WHERE id = $2`, s)
	r.pool.Exec(ctx, q, name, canvasID)
	return nil
}

func (r *ConversationsRepo) UpdateAttachmentStorage(ctx context.Context, projectID, conversationID string, body map[string]any) error {
	s := schema(projectID)
	data, _ := json.Marshal(body)
	q := fmt.Sprintf(`UPDATE %q.chat_conversations SET meta = jsonb_set(COALESCE(meta, '{}')::jsonb, '{attachment_storage}', $1::jsonb) WHERE id = $2`, s)
	r.pool.Exec(ctx, q, data, conversationID)
	return nil
}

func (r *ConversationsRepo) AddAttachments(ctx context.Context, projectID, conversationID string, body map[string]any) error {
	s := schema(projectID)
	data, _ := json.Marshal(body)
	q := fmt.Sprintf(`UPDATE %q.chat_conversations SET meta = jsonb_set(COALESCE(meta, '{}')::jsonb, '{attachments}', $1::jsonb) WHERE id = $2`, s)
	r.pool.Exec(ctx, q, data, conversationID)
	return nil
}

func (r *ConversationsRepo) DeleteAttachments(ctx context.Context, projectID, conversationID string) error {
	s := schema(projectID)
	q := fmt.Sprintf(`UPDATE %q.chat_conversations SET meta = (COALESCE(meta, '{}')::jsonb - 'attachments') WHERE id = $1`, s)
	r.pool.Exec(ctx, q, conversationID)
	return nil
}

func (r *ConversationsRepo) GetContextAnalytics(ctx context.Context, projectID, conversationID string) (map[string]any, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`SELECT COUNT(*) FROM %q.chat_message_group WHERE conversation_id = $1`, s)
	var count int
	if err := r.pool.QueryRow(ctx, q, conversationID).Scan(&count); err != nil {
		return map[string]any{"token_count": 0, "max_tokens": 128000}, nil
	}
	return map[string]any{"token_count": count * 500, "max_tokens": 128000}, nil
}

func (r *ConversationsRepo) UpdateContextStrategy(ctx context.Context, projectID, conversationID string, body map[string]any) error {
	s := schema(projectID)
	data, _ := json.Marshal(body)
	q := fmt.Sprintf(`UPDATE %q.chat_conversations SET meta = jsonb_set(COALESCE(meta, '{}')::jsonb, '{context_strategy}', $1::jsonb) WHERE id = $2`, s)
	r.pool.Exec(ctx, q, data, conversationID)
	return nil
}

func (r *ConversationsRepo) DeleteMessages(ctx context.Context, projectID, conversationID string) error {
	s := schema(projectID)
	q := fmt.Sprintf(`DELETE FROM %q.chat_messages WHERE conversation_id = $1`, s)
	_, err := r.pool.Exec(ctx, q, conversationID)
	if err != nil {
		return fmt.Errorf("conversations: delete messages: %w", err)
	}
	return nil
}

func (r *ConversationsRepo) DeleteMessage(ctx context.Context, projectID, groupUID string) error {
	s := schema(projectID)
	q := fmt.Sprintf(`DELETE FROM %q.chat_messages WHERE group_uid = $1`, s)
	_, err := r.pool.Exec(ctx, q, groupUID)
	if err != nil {
		return fmt.Errorf("conversations: delete message: %w", err)
	}
	return nil
}

func (r *ConversationsRepo) ListMessages(ctx context.Context, projectID, conversationID string, page, pageSize int) (conversations.MessagesListResponse, error) {
	s := schema(projectID)

	var total int
	countQ := fmt.Sprintf(`SELECT COUNT(*) FROM %q.chat_message_group WHERE conversation_id = $1`, s)
	if err := r.pool.QueryRow(ctx, countQ, conversationID).Scan(&total); err != nil {
		return conversations.MessagesListResponse{Items: []conversations.Message{}, Total: 0, Page: page, PageSize: pageSize}, nil
	}

	offset := (page - 1) * pageSize
	q := fmt.Sprintf(`
		SELECT mg.id, mg.conversation_id, COALESCE(mg.uuid::text, ''), mg.meta, mg.created_at
		FROM %q.chat_message_group mg
		WHERE mg.conversation_id = $1
		ORDER BY mg.created_at ASC
		LIMIT $2 OFFSET $3`, s)

	rows, err := r.pool.Query(ctx, q, conversationID, pageSize, offset)
	if err != nil {
		return conversations.MessagesListResponse{Items: []conversations.Message{}, Total: 0, Page: page, PageSize: pageSize}, nil
	}
	defer rows.Close()

	var items []conversations.Message
	for rows.Next() {
		var m conversations.Message
		var meta []byte
		rows.Scan(&m.ID, &m.ConversationID, &m.Role, &meta, &m.CreatedAt)
		if meta != nil {
			json.Unmarshal(meta, &m.Metadata)
		}
		m.ContentType = "text"
		items = append(items, m)
	}
	if items == nil {
		items = []conversations.Message{}
	}

	totalPages := total / pageSize
	if total%pageSize > 0 {
		totalPages++
	}

	return conversations.MessagesListResponse{
		Items:      items,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}
