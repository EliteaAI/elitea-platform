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
		SELECT c.id::text, c.name, COALESCE(c.uuid::text, ''), c.author_id, c.created_at, COALESCE(c.updated_at, c.created_at),
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
		rows.Scan(&c.ID, &c.Name, &c.UUID, &authorID, &c.CreatedAt, &c.UpdatedAt, &c.MessageCount)
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
		SELECT c.id::text, c.name, COALESCE(c.uuid::text, ''), c.author_id, c.created_at, COALESCE(c.updated_at, c.created_at),
			(SELECT COUNT(*) FROM %q.chat_message_group mg WHERE mg.conversation_id = c.id)
		FROM %q.chat_conversations c WHERE c.id = $1`, s, s)

	var c conversations.Conversation
	var authorID int
	err := r.pool.QueryRow(ctx, q, conversationID).Scan(
		&c.ID, &c.Name, &c.UUID, &authorID, &c.CreatedAt, &c.UpdatedAt, &c.MessageCount,
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

func (r *ConversationsRepo) ListParticipants(ctx context.Context, projectID, conversationID string) ([]conversations.Participant, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`
		SELECT p.id, p.entity_name, p.entity_meta, p.meta, pm.entity_settings
		FROM %q.chat_participant_mapping pm
		JOIN %q.chat_participants p ON p.id = pm.participant_id
		WHERE pm.conversation_id = $1
		ORDER BY pm.id`, s, s)

	rows, err := r.pool.Query(ctx, q, conversationID)
	if err != nil {
		return []conversations.Participant{}, nil
	}
	defer rows.Close()

	var items []conversations.Participant
	for rows.Next() {
		var p conversations.Participant
		var entityMeta, meta, entitySettings []byte
		rows.Scan(&p.ID, &p.EntityName, &entityMeta, &meta, &entitySettings)
		if entityMeta != nil {
			json.Unmarshal(entityMeta, &p.EntityMeta)
		}
		if p.EntityMeta == nil {
			p.EntityMeta = map[string]any{}
		}
		if meta != nil {
			json.Unmarshal(meta, &p.Meta)
		}
		if p.Meta == nil {
			p.Meta = map[string]any{}
		}
		if entitySettings != nil {
			json.Unmarshal(entitySettings, &p.EntitySettings)
		}
		if p.EntitySettings == nil {
			p.EntitySettings = map[string]any{}
		}
		items = append(items, p)
	}
	if items == nil {
		items = []conversations.Participant{}
	}
	return items, nil
}

func (r *ConversationsRepo) Create(ctx context.Context, projectID string, conv conversations.Conversation) (conversations.Conversation, error) {
	s := schema(projectID)

	authorID := conv.CreatedBy
	if authorID == "" {
		authorID = "1"
	}

	q := fmt.Sprintf(`
		INSERT INTO %q.chat_conversations (name, author_id, is_private, meta, source)
		VALUES ($1, $2, true, '{}'::jsonb, 'api')
		RETURNING id::text, name, uuid::text, created_at, COALESCE(updated_at, created_at)`, s)

	var c conversations.Conversation
	err := r.pool.QueryRow(ctx, q, conv.Name, authorID).Scan(&c.ID, &c.Name, &c.UUID, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return conversations.Conversation{}, fmt.Errorf("conversations: create: %w", err)
	}
	c.ProjectID = projectID
	c.CreatedBy = authorID
	return c, nil
}

func (r *ConversationsRepo) Update(ctx context.Context, projectID, conversationID string, conv conversations.Conversation) (conversations.Conversation, error) {
	s := schema(projectID)

	setClauses := "updated_at = now()"
	args := []any{}
	argIdx := 1

	if conv.Name != "" {
		setClauses += fmt.Sprintf(", name = $%d", argIdx)
		args = append(args, conv.Name)
		argIdx++
	}
	if conv.FolderID != nil {
		if *conv.FolderID == "" {
			setClauses += ", folder_id = NULL"
		} else {
			setClauses += fmt.Sprintf(", folder_id = $%d", argIdx)
			args = append(args, *conv.FolderID)
			argIdx++
		}
	}

	args = append(args, conversationID)
	q := fmt.Sprintf(`UPDATE %q.chat_conversations SET %s WHERE id = $%d
		RETURNING id::text, name, COALESCE(uuid::text, ''), created_at, COALESCE(updated_at, created_at)`,
		s, setClauses, argIdx)

	var c conversations.Conversation
	err := r.pool.QueryRow(ctx, q, args...).Scan(
		&c.ID, &c.Name, &c.UUID, &c.CreatedAt, &c.UpdatedAt,
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
	// Delete dependent records first
	r.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.chat_participant_mapping WHERE conversation_id = $1`, s), conversationID)
	r.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.chat_message_group WHERE conversation_id = $1`, s), conversationID)
	r.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.chat_messages WHERE conversation_id = $1`, s), conversationID)
	r.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.chat_selected_conversations WHERE conversation_id = $1`, s), conversationID)
	r.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.chat_conversation_summaries WHERE conversation_id = $1`, s), conversationID)

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
	entitySettings, _ := json.Marshal(body["entity_settings"])
	if string(entitySettings) == "null" {
		entitySettings = []byte("{}")
	}

	q := fmt.Sprintf(`INSERT INTO %q.chat_participants (uuid, entity_name, entity_meta, meta)
		VALUES (gen_random_uuid(), $1, $2::jsonb, '{}'::json) RETURNING id`, s)
	var participantID int
	err := r.pool.QueryRow(ctx, q, entityName, entityMeta).Scan(&participantID)
	if err != nil {
		q2 := fmt.Sprintf(`SELECT id FROM %q.chat_participants WHERE entity_name = $1 AND entity_meta = $2::jsonb`, s)
		r.pool.QueryRow(ctx, q2, entityName, entityMeta).Scan(&participantID)
	}

	q3 := fmt.Sprintf(`INSERT INTO %q.chat_participant_mapping (conversation_id, participant_id, entity_settings)
		VALUES ($1, $2, $3::jsonb) ON CONFLICT ON CONSTRAINT _participant_conversation_uc DO NOTHING`, s)
	r.pool.Exec(ctx, q3, conversationID, participantID, entitySettings)
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

	messageGroupID := intFromAny(body["message_group_id"])
	messageItemID := intFromAny(body["message_item_id"])
	name, _ := body["name"].(string)
	canvasType, _ := body["canvas_type"].(string)
	if canvasType == "" {
		canvasType = "code"
	}
	meta, _ := body["meta"].(map[string]any)
	if meta == nil {
		meta = map[string]any{}
	}
	startsAt := intFromAny(body["canvas_content_starts_at"])
	endsAt := intFromAny(body["canvas_content_ends_at"])
	codeLang, _ := body["code_language"].(string)

	if startsAt > endsAt {
		return nil, apierr.BadRequest("canvas_content_starts_at must be <= canvas_content_ends_at")
	}

	// 1. Fetch the existing text message item
	q := fmt.Sprintf(`SELECT mi.id, mi.order_index, mt.content
		FROM %q.chat_message_items mi
		JOIN %q.chat_messages_text mt ON mt.id = mi.id
		WHERE mi.id = $1 AND mi.message_group_id = $2`, s, s)

	var oldItemID, orderIndex int
	var oldContent string
	err := r.pool.QueryRow(ctx, q, messageItemID, messageGroupID).Scan(&oldItemID, &orderIndex, &oldContent)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, apierr.BadRequest("No such message in message group")
		}
		return nil, fmt.Errorf("fetch message item: %w", err)
	}

	// 2. Slice content
	preContent := ""
	canvasContent := oldContent[startsAt:endsAt]
	postContent := ""
	if startsAt > 0 {
		preContent = oldContent[:startsAt]
	}
	if endsAt < len(oldContent) {
		postContent = oldContent[endsAt:]
	}

	// 3. Delete old text item (cascades from chat_messages_text)
	delTextQ := fmt.Sprintf(`DELETE FROM %q.chat_messages_text WHERE id = $1`, s)
	r.pool.Exec(ctx, delTextQ, oldItemID)
	delItemQ := fmt.Sprintf(`DELETE FROM %q.chat_message_items WHERE id = $1`, s)
	r.pool.Exec(ctx, delItemQ, oldItemID)

	// 4. Insert new items with proper ordering
	newOrder := orderIndex
	insertItemQ := fmt.Sprintf(`INSERT INTO %q.chat_message_items (uuid, item_type, order_index, meta, message_group_id)
		VALUES (gen_random_uuid(), $1, $2, '{}'::jsonb, $3) RETURNING id, uuid::text`, s)
	insertTextQ := fmt.Sprintf(`INSERT INTO %q.chat_messages_text (id, content) VALUES ($1, $2)`, s)

	if preContent != "" {
		var preID int
		var preUUID string
		err = r.pool.QueryRow(ctx, insertItemQ, "text_message", newOrder, messageGroupID).Scan(&preID, &preUUID)
		if err != nil {
			return nil, fmt.Errorf("insert pre-canvas text: %w", err)
		}
		_, err = r.pool.Exec(ctx, insertTextQ, preID, preContent)
		if err != nil {
			return nil, fmt.Errorf("insert pre-canvas text content: %w", err)
		}
		newOrder++
	}

	// Insert canvas message item
	var canvasItemID int
	var canvasUUID string
	err = r.pool.QueryRow(ctx, insertItemQ, "canvas_message", newOrder, messageGroupID).Scan(&canvasItemID, &canvasUUID)
	if err != nil {
		return nil, fmt.Errorf("insert canvas item: %w", err)
	}
	newOrder++

	// Insert canvas record
	insertCanvasQ := fmt.Sprintf(`INSERT INTO %q.chat_messages_canvas (id, name, canvas_type) VALUES ($1, $2, $3)`, s)
	_, err = r.pool.Exec(ctx, insertCanvasQ, canvasItemID, name, canvasType)
	if err != nil {
		return nil, fmt.Errorf("insert canvas record: %w", err)
	}

	// Insert canvas version
	insertVersionQ := fmt.Sprintf(`INSERT INTO %q.chat_canvas_versions (canvas_content, code_language, canvas_item_id)
		VALUES ($1, $2, $3) RETURNING id, created_at`, s)
	var versionID int
	var versionCreatedAt time.Time
	err = r.pool.QueryRow(ctx, insertVersionQ, canvasContent, nilIfEmpty(codeLang), canvasItemID).Scan(&versionID, &versionCreatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert canvas version: %w", err)
	}

	if postContent != "" {
		var postID int
		var postUUID string
		err = r.pool.QueryRow(ctx, insertItemQ, "text_message", newOrder, messageGroupID).Scan(&postID, &postUUID)
		if err != nil {
			return nil, fmt.Errorf("insert post-canvas text: %w", err)
		}
		_, err = r.pool.Exec(ctx, insertTextQ, postID, postContent)
		if err != nil {
			return nil, fmt.Errorf("insert post-canvas text content: %w", err)
		}
	}

	// 5. Re-order any existing items that were before the old item
	reorderQ := fmt.Sprintf(`UPDATE %q.chat_message_items
		SET order_index = order_index + 100
		WHERE message_group_id = $1 AND id != $2 AND order_index < $3`, s)
	r.pool.Exec(ctx, reorderQ, messageGroupID, canvasItemID, orderIndex)

	// 6. Build response matching CanvasItemDetail
	result := map[string]any{
		"id":          canvasItemID,
		"uuid":        canvasUUID,
		"name":        name,
		"canvas_type": canvasType,
		"item_type":   "canvas_message",
		"meta":        meta,
		"editors":     []any{},
		"created_at":  versionCreatedAt,
		"latest_version": map[string]any{
			"id":             versionID,
			"canvas_content": canvasContent,
			"code_language":  codeLang,
			"created_at":     versionCreatedAt,
		},
	}

	return result, nil
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

func (r *ConversationsRepo) GetMessageByUUID(ctx context.Context, projectID, messageUUID string) (map[string]any, error) {
	s := schema(projectID)

	// Get message group by UUID
	q := fmt.Sprintf(`SELECT mg.id, mg.uuid::text, mg.author_participant_id, mg.sent_to_id, mg.reply_to_id, mg.meta
		FROM %q.chat_message_group mg WHERE mg.uuid::text = $1`, s)

	var groupID int
	var groupUUID string
	var authorPID *int
	var sentToID, replyToID *int
	var metaBytes []byte
	err := r.pool.QueryRow(ctx, q, messageUUID).Scan(&groupID, &groupUUID, &authorPID, &sentToID, &replyToID, &metaBytes)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, apierr.NotFound("message not found")
		}
		return nil, fmt.Errorf("get message: %w", err)
	}

	var meta map[string]any
	json.Unmarshal(metaBytes, &meta)

	// Get message items with their content, ordered
	qi := fmt.Sprintf(`SELECT mi.id, mi.uuid::text, mi.item_type, mi.order_index, mi.meta,
		COALESCE(mt.content, '') as text_content,
		COALESCE(mc.name, '') as canvas_name,
		COALESCE(mc.canvas_type, '') as canvas_type
		FROM %q.chat_message_items mi
		LEFT JOIN %q.chat_messages_text mt ON mt.id = mi.id
		LEFT JOIN %q.chat_messages_canvas mc ON mc.id = mi.id
		WHERE mi.message_group_id = $1
		ORDER BY mi.order_index ASC`, s, s, s)

	rows, err := r.pool.Query(ctx, qi, groupID)
	if err != nil {
		return nil, fmt.Errorf("query message items: %w", err)
	}
	defer rows.Close()

	var items []map[string]any
	for rows.Next() {
		var itemID int
		var itemUUID, itemType string
		var oIdx int
		var itemMetaBytes []byte
		var textContent, canvasName, canvasTypeStr string
		if err := rows.Scan(&itemID, &itemUUID, &itemType, &oIdx, &itemMetaBytes, &textContent, &canvasName, &canvasTypeStr); err != nil {
			return nil, fmt.Errorf("scan message item: %w", err)
		}

		item := map[string]any{
			"id":        itemID,
			"uuid":      itemUUID,
			"item_type": itemType,
		}

		switch itemType {
		case "text_message":
			item["item_details"] = map[string]any{"content": textContent}
		case "canvas_message":
			item["item_details"] = map[string]any{
				"name":        canvasName,
				"canvas_type": canvasTypeStr,
			}
		}

		items = append(items, item)
	}

	result := map[string]any{
		"id":                    groupID,
		"uuid":                  groupUUID,
		"author_participant_id": authorPID,
		"sent_to_id":           sentToID,
		"reply_to_id":          replyToID,
		"meta":                 meta,
		"message_items":        items,
	}

	return result, nil
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

	// Get message count and conversation meta (contains context_strategy + context_analytics)
	q := fmt.Sprintf(`
		SELECT COALESCE(c.meta, '{}')::text,
			(SELECT COUNT(*) FROM %q.chat_message_group mg WHERE mg.conversation_id = c.id)
		FROM %q.chat_conversations c WHERE c.id = $1`, s, s)

	var metaRaw string
	var msgCount int
	if err := r.pool.QueryRow(ctx, q, conversationID).Scan(&metaRaw, &msgCount); err != nil {
		return r.defaultContextStatus(), nil
	}

	var meta map[string]any
	if err := json.Unmarshal([]byte(metaRaw), &meta); err != nil {
		return r.defaultContextStatus(), nil
	}

	// Extract context_strategy
	strategy, _ := meta["context_strategy"].(map[string]any)
	strategyName := "default"
	maxContextTokens := 128000
	if strategy != nil {
		if name, ok := strategy["name"].(string); ok && name != "" {
			strategyName = name
		}
		if mct, ok := strategy["max_context_tokens"].(float64); ok && mct > 0 {
			maxContextTokens = int(mct)
		}
	}

	// Extract context_analytics
	analytics, _ := meta["context_analytics"].(map[string]any)
	currentTokens := msgCount * 500
	messagesInContext := msgCount
	summariesGenerated := 0
	if analytics != nil {
		if ct, ok := analytics["current_context_tokens"].(float64); ok {
			currentTokens = int(ct)
		}
		if mic, ok := analytics["messages_in_context"].(float64); ok {
			messagesInContext = int(mic)
		}
		if sg, ok := analytics["summaries_generated"].(float64); ok {
			summariesGenerated = int(sg)
		}
	}

	utilization := float64(0)
	if maxContextTokens > 0 {
		utilization = float64(currentTokens) / float64(maxContextTokens) * 100
	}

	return map[string]any{
		"current_tokens":            currentTokens,
		"max_tokens":                maxContextTokens,
		"message_groups_in_context": messagesInContext,
		"strategy_name":             strategyName,
		"utilization":               utilization,
		"context_analytics": map[string]any{
			"summaries_generated": summariesGenerated,
		},
	}, nil
}

func (r *ConversationsRepo) defaultContextStatus() map[string]any {
	return map[string]any{
		"current_tokens":            0,
		"max_tokens":                128000,
		"message_groups_in_context": 0,
		"strategy_name":             "default",
		"utilization":               float64(0),
		"context_analytics": map[string]any{
			"summaries_generated": 0,
		},
	}
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
		SELECT mg.id, mg.conversation_id, COALESCE(mg.uuid::text, ''),
			p.entity_name, mg.meta, mg.created_at,
			COALESCE((
				SELECT string_agg(mt.content, E'\n' ORDER BY mi.order_index)
				FROM %q.chat_message_items mi
				JOIN %q.chat_messages_text mt ON mt.id = mi.id
				WHERE mi.message_group_id = mg.id AND mi.item_type = 'text_message'
			), '')
		FROM %q.chat_message_group mg
		JOIN %q.chat_participants p ON p.id = mg.author_participant_id
		WHERE mg.conversation_id = $1
		ORDER BY mg.created_at DESC
		LIMIT $2 OFFSET $3`, s, s, s, s)

	rows, err := r.pool.Query(ctx, q, conversationID, pageSize, offset)
	if err != nil {
		return conversations.MessagesListResponse{Items: []conversations.Message{}, Total: 0, Page: page, PageSize: pageSize}, nil
	}
	defer rows.Close()

	var items []conversations.Message
	for rows.Next() {
		var m conversations.Message
		var meta []byte
		var entityName string
		rows.Scan(&m.ID, &m.ConversationID, &m.UUID, &entityName, &meta, &m.CreatedAt, &m.Content)
		if meta != nil {
			json.Unmarshal(meta, &m.Metadata)
		}
		// Map entity_name to role
		if entityName == "user" {
			m.Role = "user"
		} else {
			m.Role = "assistant"
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

func (r *ConversationsRepo) ListMessageGroups(ctx context.Context, projectID, conversationID string, limit int, sortOrder string) ([]map[string]any, error) {
	s := schema(projectID)

	order := "DESC"
	if sortOrder == "asc" {
		order = "ASC"
	}

	q := fmt.Sprintf(`
		SELECT mg.id, COALESCE(mg.uuid::text, ''), mg.author_participant_id,
			mg.sent_to_id, mg.reply_to_id, mg.meta, mg.is_streaming,
			mg.created_at, mg.updated_at, mg.task_id
		FROM %q.chat_message_group mg
		WHERE mg.conversation_id = $1
		ORDER BY mg.created_at %s
		LIMIT $2`, s, order)

	rows, err := r.pool.Query(ctx, q, conversationID, limit)
	if err != nil {
		return []map[string]any{}, nil
	}
	defer rows.Close()

	var groups []map[string]any
	var groupIDs []int
	for rows.Next() {
		var id int
		var uuid string
		var authorParticipantID int
		var sentToID, replyToID *int
		var meta []byte
		var isStreaming bool
		var createdAt time.Time
		var updatedAt *time.Time
		var taskID *string

		rows.Scan(&id, &uuid, &authorParticipantID, &sentToID, &replyToID, &meta, &isStreaming, &createdAt, &updatedAt, &taskID)

		var metaObj map[string]any
		if meta != nil {
			json.Unmarshal(meta, &metaObj)
		}
		if metaObj == nil {
			metaObj = map[string]any{}
		}

		group := map[string]any{
			"id":                    id,
			"uuid":                  uuid,
			"author_participant_id": authorParticipantID,
			"meta":                  metaObj,
			"is_streaming":         isStreaming,
			"created_at":           createdAt.Format("2006-01-02 15:04:05.999999"),
			"message_items":        []map[string]any{},
		}
		if sentToID != nil {
			group["sent_to_id"] = *sentToID
		}
		if replyToID != nil {
			group["reply_to_id"] = *replyToID
		}
		if updatedAt != nil {
			group["updated_at"] = updatedAt.Format("2006-01-02 15:04:05.999999")
		}
		if taskID != nil {
			group["task_id"] = *taskID
		}

		groups = append(groups, group)
		groupIDs = append(groupIDs, id)
	}

	if len(groupIDs) == 0 {
		return []map[string]any{}, nil
	}

	// Fetch message_items with text content for all groups
	itemQ := fmt.Sprintf(`
		SELECT mi.id, mi.message_group_id, mi.item_type, mi.order_index, mi.meta,
			COALESCE(mt.content, '')
		FROM %q.chat_message_items mi
		LEFT JOIN %q.chat_messages_text mt ON mt.id = mi.id
		WHERE mi.message_group_id = ANY($1)
		ORDER BY mi.message_group_id, mi.order_index`, s, s)

	itemRows, err := r.pool.Query(ctx, itemQ, groupIDs)
	if err == nil {
		defer itemRows.Close()
		// Index groups by id for fast lookup
		groupIndex := map[int]int{}
		for i, g := range groups {
			gid, _ := g["id"].(int)
			groupIndex[gid] = i
		}

		for itemRows.Next() {
			var itemID, groupID int
			var itemType string
			var orderIndex int
			var itemMeta []byte
			var textContent string

			itemRows.Scan(&itemID, &groupID, &itemType, &orderIndex, &itemMeta, &textContent)

			item := map[string]any{
				"id":         itemID,
				"item_type":  itemType,
				"order_index": orderIndex,
			}

			if itemType == "text_message" {
				item["item_details"] = map[string]any{"content": textContent}
			}

			if idx, ok := groupIndex[groupID]; ok {
				items := groups[idx]["message_items"].([]map[string]any)
				groups[idx]["message_items"] = append(items, item)
			}
		}
	}

	// Also set "content" on each group from its text items (for backward compat)
	for i, g := range groups {
		items := g["message_items"].([]map[string]any)
		var content string
		for _, item := range items {
			if item["item_type"] == "text_message" {
				if details, ok := item["item_details"].(map[string]any); ok {
					if c, ok := details["content"].(string); ok {
						if content != "" {
							content += "\n"
						}
						content += c
					}
				}
			}
		}
		groups[i]["content"] = content
	}

	return groups, nil
}

func intFromAny(v any) int {
	switch val := v.(type) {
	case float64:
		return int(val)
	case int:
		return val
	case int64:
		return int(val)
	case json.Number:
		n, _ := val.Int64()
		return int(n)
	}
	return 0
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
