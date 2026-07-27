// Package indexsearch contains the unmounted current-route compatibility
// contract for index retrieval tools. It must not be added to production route
// composition until its durable input, cancellation and response projection
// dependencies are all available.
package indexsearch

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	searchapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexsearch"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/go-chi/chi/v5"
)

const (
	CurrentIndexSearchPath       = "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/{projectID}"
	CurrentIndexSearchPermission = "models.applications.tool.patch"
	CurrentIndexSearchMode       = auth.PermissionModeDefault
	CurrentIndexSearchSIOEvent   = "test_toolkit_tool"
	MaxCurrentSearchBodyBytes    = int64(1 << 20)
)

var ErrInvalidCurrentSearchRoute = errors.New("invalid current index-search route dependencies")

// CurrentRequest preserves the public API's selected request values. The
// toolkit configuration is not an authorization grant. A mounted use case must
// resolve visibility, configuration expansion and secret authority on the
// server before constructing the immutable worker inputs.
type CurrentRequest struct {
	ProjectID    int64
	ActorUserID  int64
	Operation    searchapp.Operation
	Toolkit      json.RawMessage
	ToolParams   json.RawMessage
	LLMModel     json.RawMessage
	LLMSettings  json.RawMessage
	Runtime      json.RawMessage
	MCPTokens    json.RawMessage
	StreamID     string
	MessageID    string
	AwaitResult  bool
	WaitSeconds  int64
	SIOEvent     string
	CallerExtras map[string]json.RawMessage
}

func (r CurrentRequest) Clone() CurrentRequest {
	r.Toolkit = append(json.RawMessage(nil), r.Toolkit...)
	r.ToolParams = append(json.RawMessage(nil), r.ToolParams...)
	r.LLMModel = append(json.RawMessage(nil), r.LLMModel...)
	r.LLMSettings = append(json.RawMessage(nil), r.LLMSettings...)
	r.Runtime = append(json.RawMessage(nil), r.Runtime...)
	r.MCPTokens = append(json.RawMessage(nil), r.MCPTokens...)
	r.CallerExtras = cloneRawMap(r.CallerExtras)
	return r
}

// CurrentSearchUseCase is intentionally source-only. Its eventual durable
// implementation must preserve the current result body and compose a safe
// artifact/data-plane response rather than putting result content in Redis.
type CurrentSearchUseCase interface {
	StartCurrentIndexSearch(context.Context, CurrentRequest) (CurrentOutcome, error)
}

// CurrentOutcome is the complete current response envelope returned by
// test_toolkit_tool_sio (for example {"task_id":"..."} or
// {"task_id":"...","result":...}). Keeping the envelope opaque preserves
// the current API's response shape and lets the timeout check use precisely the
// same `result.get("result")` branch as the Flask endpoint.
type CurrentOutcome struct {
	Response json.RawMessage
}

// TimeoutCanceller is deliberately separate from the wait. The current Flask
// API stops the task after an awaited timeout. A durable implementation must
// provide an explicit, idempotent state transition before this route can be
// mounted; simply abandoning the browser wait is not current parity.
type TimeoutCanceller interface {
	CancelCurrentIndexSearch(context.Context, CurrentRequest, string) error
}

// CurrentIndexSearchRoute has the exact current path and RBAC permission but
// is not mounted by runtime composition. It exists to lock the public boundary
// and to make missing durable dependencies fail at construction time.
type CurrentIndexSearchRoute struct {
	handler http.Handler
}

func NewCurrentIndexSearchRoute(
	useCase CurrentSearchUseCase,
	canceller TimeoutCanceller,
	authConfig apimw.AuthConfig,
	permissions auth.PermissionResolver,
) (*CurrentIndexSearchRoute, error) {
	if useCase == nil || canceller == nil || permissions == nil ||
		authConfig.PrincipalValidator == nil || authConfig.ForwardedIdentityVerifier == nil {
		return nil, ErrInvalidCurrentSearchRoute
	}
	handler := &currentIndexSearchHandler{useCase: useCase, canceller: canceller}
	endpoint := http.Handler(http.HandlerFunc(handler.start))
	endpoint = apimw.RequireResolvedPermissionsForProject(
		permissions,
		CurrentIndexSearchMode,
		func(request *http.Request) (string, bool) {
			projectID, ok := positiveCanonicalID(chi.URLParam(request, "projectID"))
			return strconv.FormatInt(projectID, 10), ok
		},
		CurrentIndexSearchPermission,
	)(endpoint)
	endpoint = apimw.Auth(authConfig)(endpoint)

	router := chi.NewRouter()
	router.Method(http.MethodPost, CurrentIndexSearchPath, endpoint)
	return &CurrentIndexSearchRoute{handler: router}, nil
}

func (route *CurrentIndexSearchRoute) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if route == nil || route.handler == nil {
		http.NotFound(writer, request)
		return
	}
	route.handler.ServeHTTP(writer, request)
}

type currentIndexSearchHandler struct {
	useCase   CurrentSearchUseCase
	canceller TimeoutCanceller
}

func (h *currentIndexSearchHandler) start(writer http.ResponseWriter, request *http.Request) {
	projectID, validProject := positiveCanonicalID(chi.URLParam(request, "projectID"))
	principal, authenticated := auth.RuntimePrincipalFromContext(request.Context())
	actorID, validActor := principal.OwningUserID()
	if !validProject {
		writeCurrentSearchValidation(writer, "project_id", "Input should be a valid integer")
		return
	}
	if !authenticated || !validActor {
		writeCurrentSearchError(writer, http.StatusUnauthorized, "authentication required")
		return
	}
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeCurrentSearchError(writer, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		return
	}

	request.Body = http.MaxBytesReader(writer, request.Body, MaxCurrentSearchBodyBytes)
	body, err := decodeCurrentSearchBody(request.Body)
	if err != nil {
		var exceeded *http.MaxBytesError
		if errors.As(err, &exceeded) {
			writeCurrentSearchError(writer, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		writeCurrentSearchValidation(writer, "body", "Invalid request body")
		return
	}
	parsed, validationErr := body.request(projectID, actorID, request.URL.Query())
	if validationErr != nil {
		writeCurrentSearchValidation(writer, validationErr.field, validationErr.message)
		return
	}

	outcome, err := h.useCase.StartCurrentIndexSearch(request.Context(), parsed.Clone())
	if err != nil {
		// The current generic endpoint exposes arbitrary exception text. The
		// source-only route intentionally refuses to reproduce that disclosure;
		// a mounted port requires a reviewed typed error mapping.
		writeCurrentSearchError(writer, http.StatusInternalServerError, "Failed to test toolkit tool")
		return
	}
	response, taskID, result, valid := currentOutcome(outcome.Response)
	if !valid {
		writeCurrentSearchError(writer, http.StatusInternalServerError, "No response from toolkit tool test")
		return
	}
	if !parsed.AwaitResult {
		writeCurrentSearchRawJSON(writer, http.StatusOK, response)
		return
	}
	if !legacyTruthyJSON(result) {
		// Preserve the current timeout intent. A cancellation failure remains
		// intentionally hidden, matching the legacy best-effort stop block.
		_ = h.canceller.CancelCurrentIndexSearch(request.Context(), parsed.Clone(), taskID)
		writeCurrentSearchError(writer, http.StatusBadRequest, "Timeout")
		return
	}
	writeCurrentSearchRawJSON(writer, http.StatusOK, response)
}

// currentOutcome returns the response envelope, the best-effort cancellation
// task ID, and its `result` field. A task ID is intentionally optional because
// the current Flask handler checks only that the response dictionary itself is
// nonempty before returning it on the asynchronous path.
func currentOutcome(raw json.RawMessage) (json.RawMessage, string, json.RawMessage, bool) {
	if !jsonObject(raw) || len(bytes.TrimSpace(raw)) == 2 {
		return nil, "", nil, false
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || len(fields) == 0 {
		return nil, "", nil, false
	}
	taskID, err := optionalJSONString(fields["task_id"])
	if err != nil {
		return nil, "", nil, false
	}
	return append(json.RawMessage(nil), raw...), taskID, append(json.RawMessage(nil), fields["result"]...), true
}

type currentSearchBody struct {
	fields map[string]json.RawMessage
}

func decodeCurrentSearchBody(reader io.Reader) (currentSearchBody, error) {
	decoder := json.NewDecoder(reader)
	decoder.UseNumber()
	var fields map[string]json.RawMessage
	if err := decoder.Decode(&fields); err != nil || fields == nil {
		if err != nil {
			return currentSearchBody{}, err
		}
		return currentSearchBody{}, errors.New("request body must be an object")
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return currentSearchBody{}, errors.New("multiple JSON values")
		}
		return currentSearchBody{}, err
	}
	return currentSearchBody{fields: fields}, nil
}

type currentSearchFieldError struct {
	field   string
	message string
}

func (b currentSearchBody) request(projectID, actorID int64, query map[string][]string) (CurrentRequest, *currentSearchFieldError) {
	toolkit := b.fields["toolkit_config"]
	if !jsonObject(toolkit) || len(bytes.TrimSpace(toolkit)) == 2 {
		return CurrentRequest{}, &currentSearchFieldError{"toolkit_config", "Input should be a valid object"}
	}
	operation, err := operationFromRaw(b.fields["tool_name"])
	if err != nil {
		return CurrentRequest{}, &currentSearchFieldError{"tool_name", "Unsupported index search tool"}
	}
	toolParams := b.fields["tool_params"]
	if len(toolParams) == 0 || bytes.Equal(bytes.TrimSpace(toolParams), []byte("null")) {
		toolParams = json.RawMessage(`{}`)
	}
	if !jsonObject(toolParams) {
		return CurrentRequest{}, &currentSearchFieldError{"tool_params", "Input should be a valid object"}
	}
	llmModel := b.fields["llm_model"]
	if len(llmModel) == 0 {
		llmModel = json.RawMessage(`"gpt-4o-mini"`)
	}
	if !jsonStringOrNull(llmModel) {
		return CurrentRequest{}, &currentSearchFieldError{"llm_model", "Input should be a valid string"}
	}
	llmSettings := b.fields["llm_settings"]
	if len(llmSettings) == 0 {
		llmSettings = json.RawMessage(`{"max_tokens":1024,"temperature":0.1}`)
	}
	if !jsonObjectOrNull(llmSettings) {
		return CurrentRequest{}, &currentSearchFieldError{"llm_settings", "Input should be a valid object"}
	}
	runtime := b.fields["runtime_config"]
	if len(runtime) == 0 {
		runtime = json.RawMessage(`{}`)
	}
	if !jsonObject(runtime) {
		return CurrentRequest{}, &currentSearchFieldError{"runtime_config", "Input should be a valid object"}
	}
	mcpTokens := b.fields["mcp_tokens"]
	if len(mcpTokens) > 0 && !jsonObjectOrNull(mcpTokens) {
		return CurrentRequest{}, &currentSearchFieldError{"mcp_tokens", "Input should be a valid object"}
	}
	streamID, messageID, err := currentCorrelations(b.fields)
	if err != nil {
		return CurrentRequest{}, &currentSearchFieldError{"stream_id", "Input should be a valid string"}
	}
	await := strings.EqualFold(queryValue(query, "await_response", "true"), "true")
	waitSeconds, err := currentWaitSeconds(queryValue(query, "timeout", ""), await)
	if err != nil {
		// Flask lets its int conversion escape as a 500. A mounted route must
		// make a reviewed public-error decision; this source contract keeps the
		// parsing distinction explicit instead of silently changing it.
		return CurrentRequest{}, &currentSearchFieldError{"timeout", "Input should be a valid integer"}
	}
	return CurrentRequest{
		ProjectID:    projectID,
		ActorUserID:  actorID,
		Operation:    operation,
		Toolkit:      append(json.RawMessage(nil), toolkit...),
		ToolParams:   append(json.RawMessage(nil), toolParams...),
		LLMModel:     append(json.RawMessage(nil), llmModel...),
		LLMSettings:  append(json.RawMessage(nil), llmSettings...),
		Runtime:      append(json.RawMessage(nil), runtime...),
		MCPTokens:    append(json.RawMessage(nil), mcpTokens...),
		StreamID:     streamID,
		MessageID:    messageID,
		AwaitResult:  await,
		WaitSeconds:  waitSeconds,
		SIOEvent:     CurrentIndexSearchSIOEvent,
		CallerExtras: unknownFields(b.fields),
	}, nil
}

func operationFromRaw(raw json.RawMessage) (searchapp.Operation, error) {
	var value string
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return "", ErrInvalidCurrentSearchRoute
	}
	operation := searchapp.Operation(value)
	if _, err := operationProto(operation); err != nil {
		return "", err
	}
	return operation, nil
}

func operationProto(operation searchapp.Operation) (string, error) {
	switch operation {
	case searchapp.SearchIndex, searchapp.StepbackSearchIndex, searchapp.ListIndexes:
		return string(operation), nil
	default:
		return "", ErrInvalidCurrentSearchRoute
	}
}

func currentCorrelations(fields map[string]json.RawMessage) (string, string, error) {
	streamID, err := optionalJSONString(fields["stream_id"])
	if err != nil {
		return "", "", err
	}
	messageID, err := optionalJSONString(fields["message_id"])
	if err != nil {
		return "", "", err
	}
	return streamID, messageID, nil
}

func optionalJSONString(raw json.RawMessage) (string, error) {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return "", nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	return value, nil
}

func currentWaitSeconds(raw string, await bool) (int64, error) {
	if raw == "" {
		if await {
			return 300, nil
		}
		return -1, nil
	}
	return strconv.ParseInt(raw, 10, 64)
}

func queryValue(values map[string][]string, key, fallback string) string {
	if found := values[key]; len(found) > 0 {
		return found[0]
	}
	return fallback
}

func unknownFields(fields map[string]json.RawMessage) map[string]json.RawMessage {
	known := map[string]struct{}{
		"toolkit_config": {}, "tool_name": {}, "tool_params": {}, "llm_model": {}, "llm_settings": {},
		"runtime_config": {}, "mcp_tokens": {}, "stream_id": {}, "message_id": {}, "sid": {}, "project_id": {},
	}
	result := make(map[string]json.RawMessage)
	for key, value := range fields {
		if _, exists := known[key]; !exists {
			result[key] = append(json.RawMessage(nil), value...)
		}
	}
	return result
}

func cloneRawMap(values map[string]json.RawMessage) map[string]json.RawMessage {
	if values == nil {
		return nil
	}
	result := make(map[string]json.RawMessage, len(values))
	for key, value := range values {
		result[key] = append(json.RawMessage(nil), value...)
	}
	return result
}

func legacyTruthyJSON(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.UseNumber()
	var value any
	if decoder.Decode(&value) != nil {
		return false
	}
	switch value := value.(type) {
	case nil:
		return false
	case bool:
		return value
	case string:
		return value != ""
	case []any:
		return len(value) > 0
	case map[string]any:
		return len(value) > 0
	case json.Number:
		number, err := value.Float64()
		return err != nil || number != 0
	default:
		return false
	}
}

func jsonObject(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) >= 2 && trimmed[0] == '{' && trimmed[len(trimmed)-1] == '}' && json.Valid(trimmed)
}

func jsonObjectOrNull(raw json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || jsonObject(raw)
}

func jsonStringOrNull(raw json.RawMessage) bool {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return true
	}
	var value string
	return json.Unmarshal(raw, &value) == nil
}

func positiveCanonicalID(raw string) (int64, bool) {
	id, err := strconv.ParseInt(raw, 10, 64)
	return id, err == nil && id > 0 && strconv.FormatInt(id, 10) == raw
}

func writeCurrentSearchValidation(writer http.ResponseWriter, field, message string) {
	writeCurrentSearchJSON(writer, http.StatusBadRequest, map[string]any{
		"error": []map[string]any{{"type": "value_error", "loc": []string{field}, "msg": message}},
	})
}

func writeCurrentSearchError(writer http.ResponseWriter, status int, message string) {
	writeCurrentSearchJSON(writer, status, map[string]string{"error": message})
}

func writeCurrentSearchJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeCurrentSearchRawJSON(writer http.ResponseWriter, status int, value json.RawMessage) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_, _ = writer.Write(value)
}
