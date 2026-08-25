package conversations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/secrets"
)

type chatPredictor struct {
	pool           *pgxpool.Pool
	secretsHandler *secrets.Handler
}

func newChatPredictor(pool *pgxpool.Pool) *chatPredictor {
	return &chatPredictor{
		pool:           pool,
		secretsHandler: secrets.NewHandler(pool),
	}
}

type modelConfig struct {
	Name            string `json:"name"`
	APIBase         string `json:"api_base"`
	APIKey          string `json:"api_key"`
	APIVersion      string `json:"api_version"`
	CredentialTitle string `json:"credential_title"`
	IsAzure         bool   `json:"is_azure"`
}

func (cp *chatPredictor) resolveModel(ctx context.Context, projectID, modelName string) (modelConfig, error) {
	s := fmt.Sprintf("p_%s", projectID)

	// Find model config by elitea_title or data->>'name'
	q := fmt.Sprintf(`SELECT c.data FROM %q.configuration c
		WHERE c.type = 'llm_model'
		AND (c.elitea_title = $1 OR c.data->>'name' = $1)
		LIMIT 1`, s)

	var modelData []byte
	err := cp.pool.QueryRow(ctx, q, modelName).Scan(&modelData)
	if err != nil {
		// Try prefix match
		q2 := fmt.Sprintf(`SELECT c.data FROM %q.configuration c
			WHERE c.type = 'llm_model'
			AND (c.elitea_title LIKE $1 OR c.data->>'name' LIKE $1)
			ORDER BY c.elitea_title LIMIT 1`, s)
		err = cp.pool.QueryRow(ctx, q2, modelName+"%").Scan(&modelData)
		if err != nil {
			return modelConfig{}, fmt.Errorf("model %q not found", modelName)
		}
	}

	var model map[string]any
	_ = json.Unmarshal(modelData, &model) // internal DB column; nil map handled below

	cfg := modelConfig{
		Name: strVal(model, "name"),
	}

	// Resolve credentials
	creds := mapVal(model, "ai_credentials")
	credTitle := strVal(creds, "elitea_title")
	cfg.CredentialTitle = credTitle

	if credTitle != "" {
		credCfg, err := cp.resolveCredentials(ctx, projectID, credTitle)
		if err != nil {
			return modelConfig{}, fmt.Errorf("resolve credentials %q: %w", credTitle, err)
		}
		cfg.APIBase = credCfg.APIBase
		cfg.APIKey = credCfg.APIKey
		cfg.APIVersion = credCfg.APIVersion
		cfg.IsAzure = credCfg.IsAzure
	}

	return cfg, nil
}

type credentialConfig struct {
	APIBase    string
	APIKey     string
	APIVersion string
	IsAzure    bool
}

func (cp *chatPredictor) resolveCredentials(ctx context.Context, projectID, credTitle string) (credentialConfig, error) {
	s := fmt.Sprintf("p_%s", projectID)

	q := fmt.Sprintf(`SELECT c.type, c.data FROM %q.configuration c
		WHERE c.elitea_title = $1
		AND c.type IN ('azure_open_ai', 'open_ai', 'amazon_bedrock', 'ai_dial')
		LIMIT 1`, s)

	var credType string
	var credData []byte
	err := cp.pool.QueryRow(ctx, q, credTitle).Scan(&credType, &credData)
	if err != nil {
		return credentialConfig{}, fmt.Errorf("credentials %q not found", credTitle)
	}

	var data map[string]any
	_ = json.Unmarshal(credData, &data) // internal DB column; nil map handled in switch below

	cfg := credentialConfig{}

	switch credType {
	case "azure_open_ai", "ai_dial":
		cfg.IsAzure = true
		cfg.APIBase = strVal(data, "api_base")
		cfg.APIVersion = strVal(data, "api_version")
		apiKey := strVal(data, "api_key")
		if strings.HasPrefix(apiKey, "{{secret.") {
			resolved, err := cp.secretsHandler.ResolveSecretValue(ctx, projectID, apiKey)
			if err != nil {
				return credentialConfig{}, fmt.Errorf("decrypt api_key: %w", err)
			}
			cfg.APIKey = resolved
		} else {
			cfg.APIKey = apiKey
		}
	case "open_ai":
		cfg.APIBase = strVal(data, "api_base")
		if cfg.APIBase == "" {
			cfg.APIBase = "https://api.openai.com/v1"
		}
		apiKey := strVal(data, "api_key")
		if strings.HasPrefix(apiKey, "{{secret.") {
			resolved, err := cp.secretsHandler.ResolveSecretValue(ctx, projectID, apiKey)
			if err != nil {
				return credentialConfig{}, fmt.Errorf("decrypt api_key: %w", err)
			}
			cfg.APIKey = resolved
		} else {
			cfg.APIKey = apiKey
		}
	case "amazon_bedrock":
		// AWS credentials - not OpenAI-compatible, skip
		return credentialConfig{}, fmt.Errorf("bedrock credentials not supported for direct LLM call")
	}

	return cfg, nil
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIRequest struct {
	Model       string          `json:"model"`
	Messages    []openAIMessage `json:"messages"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Temperature float64         `json:"temperature,omitempty"`
}

type openAIResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

func (cp *chatPredictor) callLLM(ctx context.Context, cfg modelConfig, userInput string) (string, error) {
	messages := []openAIMessage{
		{Role: "user", Content: userInput},
	}

	reqBody := openAIRequest{
		Model:       cfg.Name,
		Messages:    messages,
		MaxTokens:   1024,
		Temperature: 0.7,
	}

	body, _ := json.Marshal(reqBody)

	var url string
	if cfg.IsAzure {
		// Azure OpenAI format
		deploymentName := strings.ReplaceAll(cfg.Name, ".", "")
		url = fmt.Sprintf("%s/openai/deployments/%s/chat/completions?api-version=%s",
			strings.TrimRight(cfg.APIBase, "/"), deploymentName, cfg.APIVersion)
	} else {
		url = strings.TrimRight(cfg.APIBase, "/") + "/chat/completions"
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.IsAzure {
		req.Header.Set("api-key", cfg.APIKey)
	} else {
		req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("LLM request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("LLM returned %d: %s", resp.StatusCode, string(respBody[:min(len(respBody), 200)]))
	}

	var openAIResp openAIResponse
	if err := json.Unmarshal(respBody, &openAIResp); err != nil {
		return "", fmt.Errorf("parse LLM response: %w", err)
	}

	if len(openAIResp.Choices) == 0 {
		return "", fmt.Errorf("LLM returned no choices")
	}

	return openAIResp.Choices[0].Message.Content, nil
}

type messageGroupResult struct {
	ID                  int            `json:"id"`
	UUID                string         `json:"uuid"`
	AuthorParticipantID *int           `json:"author_participant_id"`
	SentToID            *int           `json:"sent_to_id"`
	ReplyToID           *int           `json:"reply_to_id"`
	Meta                map[string]any `json:"meta"`
	MessageItems        []messageItem  `json:"message_items"`
}

type messageItem struct {
	ID          int         `json:"id"`
	ItemDetails itemDetails `json:"item_details"`
}

type itemDetails struct {
	Content string `json:"content"`
}

func (cp *chatPredictor) findOrCreateUserParticipant(ctx context.Context, projectID string, conversationID int) (int, error) {
	s := fmt.Sprintf("p_%s", projectID)

	// Try to find existing "user" participant
	var userPID int
	q := fmt.Sprintf(`SELECT p.id FROM %q.chat_participants p
		JOIN %q.chat_participant_mapping pm ON pm.participant_id = p.id
		WHERE pm.conversation_id = $1 AND p.entity_name = 'user'
		LIMIT 1`, s, s)
	err := cp.pool.QueryRow(ctx, q, conversationID).Scan(&userPID)
	if err == nil {
		return userPID, nil
	}

	// Create a "user" participant
	var newPID int
	qi := fmt.Sprintf(`INSERT INTO %q.chat_participants (uuid, entity_name, entity_meta, meta)
		VALUES (gen_random_uuid(), 'user', '{"name":"User"}'::jsonb, '{}'::json)
		RETURNING id`, s)
	err = cp.pool.QueryRow(ctx, qi, ).Scan(&newPID)
	if err != nil {
		return 0, fmt.Errorf("create user participant: %w", err)
	}

	// Map to conversation
	// ON CONFLICT names the COLUMNS, not the constraint: only the legacy
	// bootstrap schema names this unique key `_participant_conversation_uc`,
	// and the ledgered tenant migration every real deployment runs declares it
	// anonymously. The constraint form failed there with SQLSTATE 42704.
	qm := fmt.Sprintf(`INSERT INTO %q.chat_participant_mapping (conversation_id, participant_id, entity_settings)
		VALUES ($1, $2, '{}'::jsonb)
		ON CONFLICT (participant_id, conversation_id) DO NOTHING`, s)
	_, err = cp.pool.Exec(ctx, qm, conversationID, newPID)
	if err != nil {
		return 0, fmt.Errorf("map user participant: %w", err)
	}

	return newPID, nil
}

func (cp *chatPredictor) storeAndReturnMessageGroups(
	ctx context.Context,
	projectID string,
	conversationID int,
	participantID *int,
	sentToID *int,
	userInput string,
	aiResponse string,
	executionTime float64,
	isError bool,
	errorMsg string,
) ([]messageGroupResult, error) {
	s := fmt.Sprintf("p_%s", projectID)

	// Ensure a "user" participant exists
	userPID, err := cp.findOrCreateUserParticipant(ctx, projectID, conversationID)
	if err != nil {
		return nil, err
	}

	// Create request message group
	var reqGroupID int
	var reqGroupUUID string
	q := fmt.Sprintf(`INSERT INTO %q.chat_message_group
		(uuid, author_participant_id, conversation_id, sent_to_id, reply_to_id, meta, is_streaming)
		VALUES (gen_random_uuid(), $1, $2, $3, NULL, '{}'::jsonb, false)
		RETURNING id, uuid::text`, s)
	err = cp.pool.QueryRow(ctx, q, userPID, conversationID, sentToID).Scan(&reqGroupID, &reqGroupUUID)
	if err != nil {
		return nil, fmt.Errorf("insert request group: %w", err)
	}

	// Create request message item
	var reqItemID int
	qi := fmt.Sprintf(`INSERT INTO %q.chat_message_items
		(uuid, item_type, order_index, meta, message_group_id)
		VALUES (gen_random_uuid(), 'text_message', 0, '{}'::jsonb, $1)
		RETURNING id`, s)
	err = cp.pool.QueryRow(ctx, qi, reqGroupID).Scan(&reqItemID)
	if err != nil {
		return nil, fmt.Errorf("insert request item: %w", err)
	}

	// Create request text
	qt := fmt.Sprintf(`INSERT INTO %q.chat_messages_text (id, content) VALUES ($1, $2)`, s)
	_, err = cp.pool.Exec(ctx, qt, reqItemID, userInput)
	if err != nil {
		return nil, fmt.Errorf("insert request text: %w", err)
	}

	// Create response message group
	meta := map[string]any{
		"is_error":               isError,
		"error":                  nil,
		"execution_time_seconds": executionTime,
	}
	if isError {
		meta["error"] = errorMsg
	}
	metaJSON, _ := json.Marshal(meta)

	// Response author is the agent participant (or user if no agent)
	respAuthor := userPID
	if sentToID != nil {
		respAuthor = *sentToID
	}

	var respGroupID int
	var respGroupUUID string
	qr := fmt.Sprintf(`INSERT INTO %q.chat_message_group
		(uuid, author_participant_id, conversation_id, sent_to_id, reply_to_id, meta, is_streaming)
		VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4::jsonb, false)
		RETURNING id, uuid::text`, s)
	err = cp.pool.QueryRow(ctx, qr, respAuthor, conversationID, reqGroupID, string(metaJSON)).Scan(&respGroupID, &respGroupUUID)
	if err != nil {
		return nil, fmt.Errorf("insert response group: %w", err)
	}

	// Create response message item
	var respItemID int
	err = cp.pool.QueryRow(ctx, qi, respGroupID).Scan(&respItemID)
	if err != nil {
		return nil, fmt.Errorf("insert response item: %w", err)
	}

	// Create response text
	_, err = cp.pool.Exec(ctx, qt, respItemID, aiResponse)
	if err != nil {
		return nil, fmt.Errorf("insert response text: %w", err)
	}

	// Build result
	groups := []messageGroupResult{
		{
			ID:                  reqGroupID,
			UUID:                reqGroupUUID,
			AuthorParticipantID: &userPID,
			SentToID:            sentToID,
			Meta:                map[string]any{},
			MessageItems: []messageItem{
				{ID: reqItemID, ItemDetails: itemDetails{Content: userInput}},
			},
		},
		{
			ID:                  respGroupID,
			UUID:                respGroupUUID,
			AuthorParticipantID: &respAuthor,
			ReplyToID:           &reqGroupID,
			Meta:                meta,
			MessageItems: []messageItem{
				{ID: respItemID, ItemDetails: itemDetails{Content: aiResponse}},
			},
		},
	}

	return groups, nil
}

func (cp *chatPredictor) resolveAgentPrompt(ctx context.Context, projectID string, participantID int, conversationID int) (string, string, error) {
	s := fmt.Sprintf("p_%s", projectID)

	// Get agent application_id from participant
	q := fmt.Sprintf(`SELECT p.entity_meta->>'id'
		FROM %q.chat_participants p
		JOIN %q.chat_participant_mapping pm ON pm.participant_id = p.id
		WHERE pm.conversation_id = $1 AND p.id = $2`, s, s)

	var appIDStr string
	err := cp.pool.QueryRow(ctx, q, conversationID, participantID).Scan(&appIDStr)
	if err != nil {
		return "", "", fmt.Errorf("participant %d not found", participantID)
	}

	// Get latest version's system prompt and model
	qv := fmt.Sprintf(`SELECT av.instructions, COALESCE(av.llm_settings->>'model_name', '')
		FROM %q.application_versions av
		WHERE av.application_id::text = $1
		ORDER BY av.id DESC LIMIT 1`, s)

	var instructions, modelName string
	err = cp.pool.QueryRow(ctx, qv, appIDStr).Scan(&instructions, &modelName)
	if err != nil {
		slog.Warn("agent version not found, using default", "app_id", appIDStr)
		return "", "", nil
	}

	return instructions, modelName, nil
}

func strVal(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func mapVal(m map[string]any, key string) map[string]any {
	if v, ok := m[key].(map[string]any); ok {
		return v
	}
	return nil
}
