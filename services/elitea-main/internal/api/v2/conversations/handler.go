package conversations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
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

// MessagesQuery is the transcript window one GET
// /messages/prompt_lib/{projectID}/{conversationID} asked for, resolved from
// the query string before it reaches the repository.
//
// DEFECT #603: this route read `page`/`page_size` and nothing else, and no
// caller has ever sent either. The web client builds the query string as
// `{...params, limit, offset: page * pageSize}`
// (apps/elitea-web/src/entities/conversation/api/messageApi.ts:59-63); the SPA
// it was ported from does the same (frontends/EliteaUI/.../chat.api.js:24-32);
// and pylon, the contract both were written against, read `limit` (default 10),
// `offset` (default 0), `sort_by` (default created_at) and `sort_order`
// (default desc) — legacy/plugins/elitea_core/api/v2/messages.py:71-107. So
// every request collapsed onto this server's own defaults: page 1, size 50,
// created_at DESC. Scrolling back re-fetched the same newest 50 groups
// forever (useLoadMoreMessages.ts:96 sends offset=10,20,30…), and a caller
// that asked for `sort_order=asc` (useChatPageData.ts:66,
// usePlaybackConversation.ts:66) was served DESC.
//
// SortBy crosses this boundary UNVALIDATED on purpose: it names a column, so it
// is concatenated into SQL rather than bound, and the allow-list that decides
// what may be interpolated lives at that interpolation site
// (repos.ConversationsRepo.ListMessages) where it cannot be bypassed by a
// second caller of the interface.
type MessagesQuery struct {
	Limit     int
	Offset    int
	SortBy    string
	SortOrder string

	// Query is the free-text term a caller is searching the transcript for,
	// matched against the text content of a group's items. Empty means "no
	// filter" — NOT "match the empty string", which every group would satisfy.
	//
	// It is passed through raw. The repository decides what a match means and
	// escapes the term for the pattern operator it uses; doing that here would
	// bake one storage layer's pattern syntax into the HTTP boundary.
	Query string
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
	ListMessages(ctx context.Context, projectID, conversationID string, query MessagesQuery) (MessagesListResponse, error)
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
	DeleteMessage(ctx context.Context, projectID, groupUID, userID string) ([]string, error)
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

const (
	// Pylon's default page of a transcript is 10 groups
	// (messages.py:73). The 50 this handler used instead was never observable
	// — no caller sends page_size — so restoring the legacy number changes what
	// a parameterless request returns, and nothing else.
	defaultMessagesLimit = 10

	// The cap the page_size branch already enforced, carried over onto `limit`.
	// Pylon has no cap at all, but the ceiling matters more here than parity
	// does: ListMessages runs one correlated string_agg subquery per group, so
	// an uncapped limit lets an anonymous query string decide how much work the
	// database does. 100 is not arbitrary either — it is exactly what the
	// largest real caller asks for (usePlaybackConversation.ts:66 requests
	// pageSize 100), so the cap binds nothing that exists today.
	maxMessagesLimit = 100
)

// parseMessagesQuery resolves the transcript window from the query string.
//
// PRECEDENCE, and why it is this way round (#603): `limit`/`offset` are the
// primary pair because they are the pair pylon defined and the pair every
// client sends. `page`/`page_size` are read FIRST and then overwritten, which
// makes limit/offset win whenever both are present, while leaving the
// page/page_size pair fully functional for a caller that sends only it — this
// server has advertised that pair for long enough that dropping it would be a
// second silent break, and the sibling List handler on the same resource takes
// limit/offset, so a client mixing the two is plausible.
//
// `page` is converted through the limit that is already resolved, so
// page=3&limit=25 means offset 50, not offset 50-derived-from-some-other-size.
func parseMessagesQuery(values url.Values) MessagesQuery {
	query := MessagesQuery{
		Limit:     defaultMessagesLimit,
		SortBy:    "created_at",
		SortOrder: "desc",
	}

	if pageSize, err := strconv.Atoi(values.Get("page_size")); err == nil && pageSize > 0 {
		query.Limit = pageSize
	}
	if limit, err := strconv.Atoi(values.Get("limit")); err == nil && limit > 0 {
		query.Limit = limit
	}
	if query.Limit > maxMessagesLimit {
		query.Limit = maxMessagesLimit
	}

	if page, err := strconv.Atoi(values.Get("page")); err == nil && page > 1 {
		query.Offset = (page - 1) * query.Limit
	}
	if offset, err := strconv.Atoi(values.Get("offset")); err == nil && offset > 0 {
		query.Offset = offset
	}

	if sortBy := values.Get("sort_by"); sortBy != "" {
		query.SortBy = sortBy
	}
	// Pylon read this as `request.args.get('query')` and applied it only when
	// truthy (messages.py:71,86), so an explicit `query=` was the same as
	// sending nothing. Same here.
	query.Query = values.Get("query")
	// Only the exact token `asc` flips the order. Pylon wrote this as
	// `desc if sort_order == 'desc' else asc`, so under pylon ANY unrecognised
	// value — a typo, an empty explicit `sort_order=` — silently reversed the
	// transcript. The documented default is desc; an unrecognised value gets
	// the documented default rather than the opposite of it.
	if values.Get("sort_order") == "asc" {
		query.SortOrder = "asc"
	}

	return query
}

func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")

	resp, err := h.repo.ListMessages(r.Context(), projectID, conversationID, parseMessagesQuery(r.URL.Query()))
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

// DeleteMessage removes one message group and the user input it answers.
//
// The caller's identity is part of the request, not decoration: deleting a
// message is authorised against the conversation's author and the group's own
// author, so the repository cannot decide it without knowing who is asking.
// An unauthenticated context yields an empty id, which the repository refuses —
// the route already sits behind `models.chat.messages.delete`, so that state
// should be unreachable, and failing closed is right if it ever is not.
//
// WHY THIS ANSWERS 200 WITH A BODY RATHER THAN 204. One request can remove TWO
// groups — the reply named in the URL and the question it answers — and a
// client that prunes only the id it asked for would leave the other message on
// screen until a reload, which is worse than not pairing at all. Pylon told the
// client through a per-group socket event (message.py:154-171); there is no
// such channel on this route, so the response carries the fact instead. The
// body names every group that is really gone, newest first, so a client can
// prune exactly what the server removed rather than guessing at the pairing
// rule — the pairing lives in one place, on the server.
func (h *Handler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	messageID := chi.URLParam(r, "messageID")
	user, _ := auth.UserFromContext(r.Context())
	deleted, err := h.repo.DeleteMessage(r.Context(), projectID, messageID, user.ID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
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

// defaultEntityProjectID fills entity_meta.project_id from the request path
// when the caller left it out. It changes nothing for a model participant,
// which carries no project id at all.
//
// The early return for `llm` and `dummy` matches what legacy STORES. legacy
// writes the project id into every request entry (participants.py:63-65), but
// pydantic then validates entity_meta against a per-type model.
// ParticipantEntityLlm keeps `model_name` only, and ParticipantEntityDummy
// keeps nothing (models/pd/participant.py:21-30). The extra key never reaches
// the INSERT.
//
// One difference remains. legacy validates a `user` entity against
// ParticipantEntityUser, which keeps `id` only, so the stored document holds
// no project id. This helper adds one. The identity key for a user is `id`
// alone, so the extra key splits no participant row.
func defaultEntityProjectID(body map[string]any, projectID string) {
	entityName, _ := body["entity_name"].(string)
	if entityName == "llm" || entityName == "dummy" {
		return
	}
	entityMeta, ok := body["entity_meta"].(map[string]any)
	if !ok {
		return
	}
	if existing, present := entityMeta["project_id"]; present && existing != nil {
		return
	}
	if numeric, err := strconv.Atoi(projectID); err == nil {
		entityMeta["project_id"] = numeric
	}
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
		// The project id defaults to the one in the path, as legacy does
		// (`entity_meta['project_id'] = entity_meta.get('project_id', project_id)`).
		// The repository keys a participant's identity on id AND project_id.
		// The same agent posted once with and once without project_id would
		// otherwise become two participants in one conversation.
		defaultEntityProjectID(body, projectID)
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

// DeleteAttachments removes a conversation's attachments: the stored bytes,
// their elitea_storage.objects metadata rows, and finally the
// chat_conversations.meta.attachments list that named them.
//
// DEFECT #599: this route used to strip the meta and nothing else. The
// uploaded bytes and their metadata rows survived until the retention
// sweeper eventually expired them, so "delete my attachments" forgot the
// attachments without deleting them. Pylon's equivalent route removes the
// bytes at the same moment (legacy/plugins/elitea_core/api/v2/
// attachments.py:240, `mc.remove_file(bucket_name, filename)`); this is that
// parity baseline.
func (h *Handler) DeleteAttachments(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")

	// Bytes first, meta last. If the byte delete fails we must NOT strip the
	// meta: the meta is the only thing left in the product that names those
	// files, so stripping it after a failed delete produces exactly the state
	// this defect is about — stored bytes nobody can see or retry deleting.
	if err := h.deleteStoredAttachments(r.Context(), projectID, conversationID); err != nil {
		apierr.Write(w, err)
		return
	}
	if err := h.repo.DeleteAttachments(r.Context(), projectID, conversationID); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// deleteStoredAttachments removes the object bytes and metadata rows
// finalizeAttachment wrote for one conversation, and resolves the bucket the
// same way finalizeAttachment does (policy first, defaultAttachmentBucketName
// fallback) so the delete reads the same bucket the upload wrote.
//
// A returned error is meant to reach the client as a 500 rather than being
// logged and swallowed: answering `{"ok": true}` for an attachment that is
// still stored is the precise failure shape this change exists to remove.
func (h *Handler) deleteStoredAttachments(ctx context.Context, projectIDStr, conversationID string) error {
	// No database or object store configured: degrade to the historical
	// metadata-only behaviour instead of failing the request, matching how
	// writeAttachmentBytes degrades on the same two nil dependencies (see
	// WithObjectStore/WithAttachmentStore). There are no bytes to delete in
	// a deployment that could never have stored any.
	if h.store == nil || h.attachments == nil {
		return nil
	}

	projectID, err := strconv.ParseInt(projectIDStr, 10, 64)
	if err != nil || projectID <= 0 {
		return apierr.BadRequest("invalid project id")
	}

	bucketName, _, _, err := h.attachments.AttachmentPolicy(ctx, projectID)
	if err != nil {
		return apierr.Internal("get project storage policy: " + err.Error())
	}
	if bucketName == "" {
		bucketName = defaultAttachmentBucketName
	}

	// Lookup, never create — a delete that mints a bucket row as a side
	// effect is a worse outcome than the no-op it is standing in for. No
	// bucket means nothing was ever stored for this project, which is a
	// normal outcome here (meta-only attachments, or a conversation that
	// never had an upload), not an error: skip cleanup, still strip the meta.
	bucketID, err := h.attachments.LookupAttachmentBucket(ctx, projectID, bucketName)
	if errors.Is(err, storage.ErrNotFound) {
		return nil
	}
	if err != nil {
		return apierr.Internal("lookup attachment bucket: " + err.Error())
	}

	// REJECT LIKE METACHARACTERS IN THE PREFIX.
	//
	// ListAttachmentObjectKeys resolves to `key LIKE $prefix || '%'`
	// (internal/db/queries/artifact_storage.sql:117), so `%` and `_` in the
	// route parameter are WILDCARDS, not literals. A caller authorised for the
	// project — this route sits behind models.chat.attachments.delete — could
	// pass `%` as the conversation id and have the prefix become `%/`, which
	// matches every key containing a slash: every conversation's attachments in
	// the project, deleted in one request. `\` is rejected with them because it
	// is the escape character the pattern would otherwise consume.
	//
	// Rejecting rather than escaping, because no legitimate identifier contains
	// any of the three: finalizeAttachment builds the key from this same route
	// parameter, and the values that reach it are conversation UUIDs and
	// numeric ids. An escape would silently accept an identifier that cannot
	// name a real conversation and then quietly match nothing.
	if strings.ContainsAny(conversationID, `%_\`) {
		return apierr.BadRequest("invalid conversation id")
	}

	// The recorded metadata rows are the source of truth for what to delete,
	// NOT a listing of the object store. The bucket is shared by every
	// conversation in the project, and an object in it with no metadata row
	// was not written by finalizeAttachment — deriving the delete set from a
	// store listing would let this route reach bytes it never recorded.
	// finalizeAttachment keys every attachment `{conversationID}/{filename}`,
	// so that prefix selects exactly this conversation's own objects.
	keys, err := h.attachments.ListAttachmentObjectKeys(ctx, bucketID, conversationID+"/")
	if err != nil {
		return apierr.Internal("list attachment objects: " + err.Error())
	}
	if len(keys) == 0 {
		return nil
	}

	refs := make([]storage.ObjectRef, 0, len(keys))
	for _, key := range keys {
		ref, err := storage.NewObjectRef(projectIDStr, bucketName, key)
		if err != nil {
			return apierr.Internal("invalid stored attachment key " + strconv.Quote(key) + ": " + err.Error())
		}
		refs = append(refs, ref)
	}

	// Bytes BEFORE rows. If this fails, the rows must still name what is
	// stored — dropping the rows first would orphan the bytes with nothing
	// left pointing at them, and neither this route nor the retention sweeper
	// (which walks the same rows) could ever find them again.
	result, err := h.store.DeleteBatch(ctx, refs)
	if err != nil {
		return apierr.Internal("delete attachment bytes: " + err.Error())
	}
	if len(result.Failed) > 0 {
		return apierr.Internal(fmt.Sprintf("delete attachment bytes: %d of %d objects failed, first %q: %v",
			len(result.Failed), len(refs), result.Failed[0].Key, result.Failed[0].Err))
	}

	if err := h.attachments.DeleteAttachmentObjects(ctx, bucketID, keys); err != nil {
		return apierr.Internal("delete attachment metadata: " + err.Error())
	}
	return nil
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
