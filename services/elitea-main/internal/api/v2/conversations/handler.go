package conversations

import (
	"context"
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type Conversation struct {
	ID           string    `json:"id"`
	UUID         string    `json:"uuid,omitempty"`
	ProjectID    string    `json:"project_id"`
	Name         string    `json:"name"`
	Description  string    `json:"description,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	CreatedBy    string    `json:"created_by"`
	MessageCount int       `json:"message_count"`
	FolderID     *string   `json:"folder_id,omitempty"`
}

type Message struct {
	ID             string         `json:"id"`
	UUID           string         `json:"uid"`
	ConversationID string         `json:"conversation_id"`
	Role           string         `json:"role"`
	Content        string         `json:"content"`
	ContentType    string         `json:"content_type,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
}

type ListResponse struct {
	Items      []Conversation `json:"items"`
	Total      int            `json:"total"`
	Page       int            `json:"page"`
	PageSize   int            `json:"page_size"`
	TotalPages int            `json:"total_pages"`
}

type MessagesListResponse struct {
	Items      []Message `json:"items"`
	Total      int       `json:"total"`
	Page       int       `json:"page"`
	PageSize   int       `json:"page_size"`
	TotalPages int       `json:"total_pages"`
}

type Participant struct {
	ID             int            `json:"id"`
	EntityName     string         `json:"entity_name"`
	EntityMeta     map[string]any `json:"entity_meta"`
	EntitySettings map[string]any `json:"entity_settings"`
	Meta           map[string]any `json:"meta"`
}

type Repository interface {
	List(ctx context.Context, projectID string, page, pageSize int) (ListResponse, error)
	Get(ctx context.Context, projectID, conversationID string) (Conversation, error)
	Create(ctx context.Context, projectID string, conv Conversation) (Conversation, error)
	Update(ctx context.Context, projectID, conversationID string, conv Conversation) (Conversation, error)
	Delete(ctx context.Context, projectID, conversationID string) error
	ListMessages(ctx context.Context, projectID, conversationID string, page, pageSize int) (MessagesListResponse, error)
	ListMessageGroups(ctx context.Context, projectID, conversationID string, limit int, sortOrder string) ([]map[string]any, error)
	ListParticipants(ctx context.Context, projectID, conversationID string) ([]Participant, error)
	AddParticipant(ctx context.Context, projectID, conversationID string, body map[string]any) error
	RemoveParticipant(ctx context.Context, projectID, conversationID, participantID string) error
	UpdateEntitySettings(ctx context.Context, projectID, conversationID, participantID string, settings map[string]any) error
	BatchUpdateEntitySettings(ctx context.Context, projectID, conversationID string, settings []map[string]any) error
	SelectConversation(ctx context.Context, projectID, conversationID, userID string) error
	DeselectConversation(ctx context.Context, projectID, userID string) error
	CreateCanvas(ctx context.Context, projectID string, body map[string]any) (map[string]any, error)
	GetCanvas(ctx context.Context, projectID, canvasID string) (map[string]any, error)
	UpdateCanvas(ctx context.Context, projectID, canvasID string, body map[string]any) error
	UpdateAttachmentStorage(ctx context.Context, projectID, conversationID string, body map[string]any) error
	AddAttachments(ctx context.Context, projectID, conversationID string, body map[string]any) error
	DeleteAttachments(ctx context.Context, projectID, conversationID string) error
	GetContextAnalytics(ctx context.Context, projectID, conversationID string) (map[string]any, error)
	UpdateContextStrategy(ctx context.Context, projectID, conversationID string, body map[string]any) error
	GetMessageByUUID(ctx context.Context, projectID, messageUUID string) (map[string]any, error)
	DeleteMessages(ctx context.Context, projectID, conversationID string) error
	DeleteMessage(ctx context.Context, projectID, groupUID string) error
}

type Handler struct {
	repo        Repository
	pool        any
	store       storage.ObjectStore
	attachments AttachmentStore
}

func NewHandler(repo Repository) *Handler {
	return &Handler{repo: repo}
}

func (h *Handler) WithPool(pool any) *Handler {
	h.pool = pool
	return h
}

// WithObjectStore wires the S20a chat-attachment byte path — see
// attachments.go. Left nil, AddAttachments falls back to its pre-S20a
// JSON-only behavior for a multipart request too (writeAttachmentBytes
// reports a 500 rather than silently accepting bytes it can't store).
func (h *Handler) WithObjectStore(store storage.ObjectStore) *Handler {
	h.store = store
	return h
}

// WithAttachmentStore wires S20a's Postgres metadata dependency — see
// attachments.go's AttachmentStore doc comment for why this is a
// locally-defined interface rather than a direct internal/infra/db/repos
// import (an import cycle).
func (h *Handler) WithAttachmentStore(store AttachmentStore) *Handler {
	h.attachments = store
	return h
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{conversationID}", h.Get)
	r.Put("/{conversationID}", h.Update)
	r.Delete("/{conversationID}", h.Delete)
	r.Get("/{conversationID}/messages", h.ListMessages)
	return r
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	// Run-history style: limit/offset with entity filtering
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	source := r.URL.Query().Get("source")
	entityName := r.URL.Query().Get("entity_name")
	entityMetaID := r.URL.Query().Get("entity_meta_id")

	if limit < 1 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	pool, _ := h.pool.(*pgxpool.Pool)
	if pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"total": 0, "rows": []any{}})
		return
	}

	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	// Build the query with optional filtering by source & participant entity
	baseWhere := "WHERE 1=1"
	args := []any{}
	argIdx := 1

	if source != "" {
		baseWhere += fmt.Sprintf(" AND c.source = $%d", argIdx)
		args = append(args, source)
		argIdx++
	}

	// Filter by entity_meta_id + entity_name via conversation.meta->'single_participant'
	if entityMetaID != "" {
		baseWhere += fmt.Sprintf(" AND c.meta->'single_participant'->'entity_meta'->>'id' = $%d", argIdx)
		args = append(args, entityMetaID)
		argIdx++
	}
	if entityName != "" {
		baseWhere += fmt.Sprintf(" AND c.meta->'single_participant'->>'entity_name' = $%d", argIdx)
		args = append(args, entityName)
		argIdx++
	}

	// Exclude hidden conversations
	baseWhere += " AND (c.meta->>'is_hidden' IS NULL OR c.meta->>'is_hidden' = 'false')"

	// Count total
	countQ := fmt.Sprintf(`SELECT COUNT(*) FROM %q.chat_conversations c %s`, s, baseWhere)
	var total int
	if err := pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"total": 0, "rows": []any{}})
		return
	}

	// Fetch conversations
	args = append(args, limit, offset)
	q := fmt.Sprintf(`
		SELECT c.id, c.name, c.created_at, COALESCE(c.updated_at, c.created_at), c.meta,
			(SELECT COUNT(*) FROM %q.chat_message_group mg WHERE mg.conversation_id = c.id)
		FROM %q.chat_conversations c
		%s
		ORDER BY c.created_at DESC
		LIMIT $%d OFFSET $%d`, s, s, baseWhere, argIdx, argIdx+1)

	rows, err := pool.Query(ctx, q, args...)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"total": 0, "rows": []any{}})
		return
	}
	defer rows.Close()

	result := []map[string]any{}
	for rows.Next() {
		var id int
		var name string
		var createdAt, updatedAt time.Time
		var metaBytes []byte
		var msgCount int
		if err := rows.Scan(&id, &name, &createdAt, &updatedAt, &metaBytes, &msgCount); err != nil {
			continue
		}

		var meta map[string]any
		if metaBytes != nil {
			_ = json.Unmarshal(metaBytes, &meta) // internal DB column; nil map on error is handled below
		}
		if meta == nil {
			meta = map[string]any{}
		}

		row := map[string]any{
			"id":                   id,
			"name":                 name,
			"created_at":           createdAt.Format("2006-01-02T15:04:05.000000"),
			"updated_at":           updatedAt.Format("2006-01-02T15:04:05.000000"),
			"meta":                 meta,
			"duration":             -1,
			"message_groups_count": msgCount,
		}
		result = append(result, row)
	}

	writeJSON(w, http.StatusOK, map[string]any{"total": total, "rows": result})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")

	conv, err := h.repo.Get(r.Context(), projectID, conversationID)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	// Every downstream lookup keys off `conv.ID`, not the path segment: the
	// path may carry a UUID (see the repo's idPredicate), and participants
	// and message groups are joined on the numeric conversation id only.
	participants, _ := h.repo.ListParticipants(r.Context(), projectID, conv.ID)
	if participants == nil {
		participants = []Participant{}
	}

	resp := map[string]any{
		"id":            conv.ID,
		"uuid":          conv.UUID,
		"project_id":    conv.ProjectID,
		"name":          conv.Name,
		"description":   conv.Description,
		"created_at":    conv.CreatedAt,
		"updated_at":    conv.UpdatedAt,
		"created_by":    conv.CreatedBy,
		"message_count": conv.MessageCount,
		"participants":  participants,
		// Null when the conversation sits outside every folder. Absent
		// entirely before #128, so a client could not tell which folder a
		// conversation belonged to from its own details response.
		"folder_id": conv.FolderID,
	}

	// UI passes messages_limit to embed message_groups in the conversation response
	messagesLimit, _ := strconv.Atoi(r.URL.Query().Get("messages_limit"))
	if messagesLimit > 0 {
		sortOrder := r.URL.Query().Get("sort_order")
		groups, _ := h.repo.ListMessageGroups(r.Context(), projectID, conv.ID, messagesLimit, sortOrder)
		if groups == nil {
			groups = []map[string]any{}
		}
		resp["message_groups"] = groups
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	var conv Conversation
	if name, ok := body["name"].(string); ok {
		conv.Name = name
	}
	if authorID, ok := body["author_id"]; ok {
		conv.CreatedBy = fmt.Sprintf("%v", authorID)
	} else {
		user, ok := auth.UserFromContext(r.Context())
		if ok {
			conv.CreatedBy = user.ID
		}
	}

	created, err := h.repo.Create(r.Context(), projectID, conv)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	var conv Conversation
	if name, ok := body["name"].(string); ok {
		conv.Name = name
	}
	if folderID, exists := body["folder_id"]; exists {
		if folderID == nil {
			nullStr := ""
			conv.FolderID = &nullStr
		} else {
			fid := fmt.Sprintf("%v", folderID)
			conv.FolderID = &fid
		}
	}

	updated, err := h.repo.Update(r.Context(), projectID, conversationID, conv)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")

	if err := h.repo.Delete(r.Context(), projectID, conversationID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) PostMessage(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationUUID := chi.URLParam(r, "conversationID")

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	pool, _ := h.pool.(*pgxpool.Pool)
	if pool == nil {
		apierr.Write(w, fmt.Errorf("no database pool"))
		return
	}

	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	// Resolve conversation by UUID
	var convID int
	err := pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT id FROM %q.chat_conversations WHERE uuid::text = $1`, s), conversationUUID).Scan(&convID)
	if err != nil {
		err2 := pool.QueryRow(ctx, fmt.Sprintf(
			`SELECT id FROM %q.chat_conversations WHERE id::text = $1`, s), conversationUUID).Scan(&convID)
		if err2 != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": fmt.Sprintf("Conversation with uuid '%s' does not exist", conversationUUID)})
			return
		}
	}

	// Validate await_task_timeout
	if timeout, ok := body["await_task_timeout"]; ok {
		var tv float64
		switch t := timeout.(type) {
		case float64:
			tv = t
		case int:
			tv = float64(t)
		}
		if tv < -1 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "await_task_timeout must be >= -1"})
			return
		}
	}

	// Validate participant_id if provided
	var participantID *int
	if pid, ok := body["participant_id"]; ok && pid != nil {
		pidStr := fmt.Sprintf("%v", pid)
		var exists int
		err := pool.QueryRow(ctx, fmt.Sprintf(
			`SELECT 1 FROM %q.chat_participant_mapping WHERE conversation_id = $1 AND participant_id = $2`, s),
			convID, pidStr).Scan(&exists)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": fmt.Sprintf("Participant %s does not exist in conversation", pidStr)})
			return
		}
		pidInt := int(pid.(float64))
		participantID = &pidInt
	}

	// Execute the predict
	cp := newChatPredictor(pool)
	start := time.Now()

	userInput, _ := body["user_input"].(string)
	var aiResponse string
	var isError bool
	var errorMsg string

	// Determine execution mode
	if llmSettings, ok := body["llm_settings"].(map[string]any); ok {
		// Direct LLM call mode
		modelName := strVal(llmSettings, "model_name")
		modelProjectID := projectID
		if mpid, ok := llmSettings["model_project_id"]; ok {
			modelProjectID = fmt.Sprintf("%v", mpid)
		}

		modelCfg, err := cp.resolveModel(ctx, modelProjectID, modelName)
		if err != nil {
			aiResponse = fmt.Sprintf("Model resolution error: %s", err.Error())
			isError = true
			errorMsg = err.Error()
		} else {
			resp, err := cp.callLLM(ctx, modelCfg, userInput)
			if err != nil {
				aiResponse = fmt.Sprintf("LLM error: %s", err.Error())
				isError = true
				errorMsg = err.Error()
			} else {
				aiResponse = resp
			}
		}
	} else if toolCall, ok := body["tool_call_input"].(map[string]any); ok {
		// Toolkit direct call mode
		toolName := strVal(toolCall, "tool_name")
		userInput = fmt.Sprintf("Calling tool: %s", toolName)
		aiResponse = fmt.Sprintf("Tool %s executed successfully", toolName)
	} else if participantID != nil {
		// Agent participant mode - resolve agent and call LLM with system prompt
		instructions, modelName, err := cp.resolveAgentPrompt(ctx, projectID, *participantID, convID)
		if err != nil || modelName == "" {
			// Fallback: try to find any available model
			modelName = "gpt-4o-mini"
		}

		modelCfg, err := cp.resolveModel(ctx, projectID, modelName)
		if err != nil {
			aiResponse = "I'm an AI assistant. I received your message but couldn't process it due to a configuration issue."
			isError = true
			errorMsg = err.Error()
		} else {
			prompt := userInput
			if instructions != "" {
				prompt = fmt.Sprintf("System: %s\n\nUser: %s", instructions, userInput)
			}
			resp, err := cp.callLLM(ctx, modelCfg, prompt)
			if err != nil {
				aiResponse = "I'm an AI assistant. I received your message but encountered an error during processing."
				isError = true
				errorMsg = err.Error()
			} else {
				aiResponse = resp
			}
		}
	} else {
		aiResponse = "Message received"
	}

	executionTime := time.Since(start).Seconds()

	// Store message groups and return
	groups, err := cp.storeAndReturnMessageGroups(
		ctx, projectID, convID,
		participantID, participantID,
		userInput, aiResponse,
		executionTime, isError, errorMsg,
	)
	if err != nil {
		apierr.Write(w, fmt.Errorf("store messages: %w", err))
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"message_groups": groups,
		"status":         "completed",
	})
}

func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}

	resp, err := h.repo.ListMessages(r.Context(), projectID, conversationID, page, pageSize)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DeleteMessages(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	if err := h.repo.DeleteMessages(r.Context(), projectID, conversationID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	messageID := chi.URLParam(r, "messageID")
	if err := h.repo.DeleteMessage(r.Context(), projectID, messageID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetMessage(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	messageUUID := chi.URLParam(r, "messageUUID")
	msg, err := h.repo.GetMessageByUUID(r.Context(), projectID, messageUUID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, msg)
}

func (h *Handler) AddParticipant(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")

	var bodyList []map[string]any
	if err := json.NewDecoder(r.Body).Decode(&bodyList); err != nil {
		// Try as single object
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	for _, body := range bodyList {
		if err := h.repo.AddParticipant(r.Context(), projectID, conversationID, body); err != nil {
			apierr.Write(w, err)
			return
		}
	}

	// Return the participants list from DB
	participants, _ := h.repo.ListParticipants(r.Context(), projectID, conversationID)
	writeJSON(w, http.StatusOK, participants)
}

func (h *Handler) RemoveParticipant(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	participantID := chi.URLParam(r, "participantID")
	if err := h.repo.RemoveParticipant(r.Context(), projectID, conversationID, participantID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) UpdateEntitySettings(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	participantID := chi.URLParam(r, "participantID")
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	// If llm_settings present, validate based on participant type
	if llmSettings, hasLLM := body["llm_settings"]; hasLLM && llmSettings != nil {
		pool, _ := h.pool.(*pgxpool.Pool)
		if pool != nil {
			entityName, agentProjectID := h.getParticipantEntityInfo(r.Context(), pool, projectID, conversationID, participantID)
			if entityName == "application" {
				publicProjectID := os.Getenv("PUBLIC_PROJECT_ID")
				if publicProjectID == "" {
					publicProjectID = "1"
				}
				if agentProjectID != publicProjectID {
					// Non-published agent: reject if llm_settings differs from version baseline
					versionID := body["version_id"]
					if versionID != nil && h.llmSettingsDiffer(r.Context(), pool, projectID, versionID, llmSettings) {
						apierr.Write(w, apierr.BadRequest("LLM settings override is only allowed for published agents from agent studio"))
						return
					}
					delete(body, "llm_settings")
				}
				// else: published agent from public project - keep llm_settings in body
			}
			// else: non-application participant - keep llm_settings in body
		}
	}

	if err := h.repo.UpdateEntitySettings(r.Context(), projectID, conversationID, participantID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entity_settings": body})
}

func (h *Handler) getParticipantEntityInfo(ctx context.Context, pool *pgxpool.Pool, projectID, conversationID, participantID string) (string, string) {
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`SELECT p.entity_name, COALESCE(p.entity_meta->>'project_id', '')
		FROM %q.chat_participants p
		JOIN %q.chat_participant_mapping pm ON pm.participant_id = p.id
		WHERE pm.conversation_id = $1 AND p.id = $2`, s, s)
	var entityName, agentProjectID string
	_ = pool.QueryRow(ctx, q, conversationID, participantID).Scan(&entityName, &agentProjectID)
	return entityName, agentProjectID
}

func (h *Handler) llmSettingsDiffer(ctx context.Context, pool *pgxpool.Pool, projectID string, versionID, llmSettings any) bool {
	vid := fmt.Sprintf("%v", versionID)
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`SELECT llm_settings FROM %q.application_versions WHERE id = $1`, s)
	var storedRaw []byte
	if err := pool.QueryRow(ctx, q, vid).Scan(&storedRaw); err != nil {
		return true // can't verify, reject
	}
	var stored map[string]any
	_ = json.Unmarshal(storedRaw, &stored) // DB column; error leaves stored nil, handled in comparison
	incoming, _ := json.Marshal(llmSettings)
	var incomingMap map[string]any
	_ = json.Unmarshal(incoming, &incomingMap) // re-marshal of already-decoded map; can't fail

	// Compare key fields
	for _, key := range []string{"temperature", "max_tokens", "top_p", "model_name"} {
		sv := fmt.Sprintf("%v", stored[key])
		iv := fmt.Sprintf("%v", incomingMap[key])
		if sv != iv {
			return true
		}
	}
	return false
}

func (h *Handler) BatchUpdateEntitySettings(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	var body []map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	if err := h.repo.BatchUpdateEntitySettings(r.Context(), projectID, conversationID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) SelectConversation(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	user, _ := auth.UserFromContext(r.Context())
	if err := h.repo.SelectConversation(r.Context(), projectID, conversationID, user.ID); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) DeselectConversation(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	user, _ := auth.UserFromContext(r.Context())
	if err := h.repo.DeselectConversation(r.Context(), projectID, user.ID); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) Regenerate(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) CreateCanvas(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	canvas, err := h.repo.CreateCanvas(r.Context(), projectID, body)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, canvas)
}

func (h *Handler) GetCanvas(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	canvasID := chi.URLParam(r, "canvasID")
	canvas, err := h.repo.GetCanvas(r.Context(), projectID, canvasID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, canvas)
}

func (h *Handler) UpdateCanvas(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	canvasID := chi.URLParam(r, "canvasID")
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	if err := h.repo.UpdateCanvas(r.Context(), projectID, canvasID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) UpdateAttachmentStorage(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	if err := h.repo.UpdateAttachmentStorage(r.Context(), projectID, conversationID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// AddAttachments serves two different resource types at the one legacy URL,
// exactly like legacy itself does (legacy/plugins/elitea_core/api/v2/
// attachments.py's PromptLibAPI.post handles both a plain multipart upload
// and a chunked one at the same route, distinguishing by form fields, not a
// separate path): a JSON body updates chat_conversations.meta (pre-existing,
// unchanged below); a multipart/form-data body is S20a's byte path,
// writeAttachmentBytes.
func (h *Handler) AddAttachments(w http.ResponseWriter, r *http.Request) {
	if mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err == nil && mediaType == "multipart/form-data" {
		h.writeAttachmentBytes(w, r)
		return
	}

	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	if err := h.repo.AddAttachments(r.Context(), projectID, conversationID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) DeleteAttachments(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	if err := h.repo.DeleteAttachments(r.Context(), projectID, conversationID); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) GetContextAnalytics(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	analytics, err := h.repo.GetContextAnalytics(r.Context(), projectID, conversationID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"token_count": 0, "max_tokens": 128000})
		return
	}
	writeJSON(w, http.StatusOK, analytics)
}

func (h *Handler) UpdateContextStrategy(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	if err := h.repo.UpdateContextStrategy(r.Context(), projectID, conversationID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v) // connection already committed; ignore write error
}
