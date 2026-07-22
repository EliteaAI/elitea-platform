// Package llmproxy implements the current /llm data-plane facade.
//
// The facade keeps project authorization and model routing in Main while
// forwarding AI payloads directly to LiteLLM over HTTP. Redis is not involved.
package llmproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/litellm"
)

const (
	CurrentPublicPrefix = "/llm"

	defaultRequestTimeout = 10 * time.Minute
	maxRequestTimeout     = time.Hour
	defaultMaxHeaderBytes = int64(64 << 10)
	maxHeaderBytes        = int64(1 << 20)
	defaultMaxBodyBytes   = int64(64 << 20)
	maxBodyBytes          = int64(256 << 20)
	defaultStreamBuffer   = 32 << 10
	maxStreamBuffer       = 64 << 10
	maxIdentityBytes      = 4096
)

var ErrInvalidConfiguration = errors.New("llm proxy: invalid configuration")

var exactCurrentEndpoints = map[string]struct{}{
	"/v1/models":             {},
	"/v1/completions":        {},
	"/v1/chat/completions":   {},
	"/v1/responses":          {},
	"/v1/messages":           {},
	"/v1/embeddings":         {},
	"/v1/images/generations": {},
	"/v1/images/edits":       {},
	"/v1/images/variations":  {},
}

var currentEndpointPrefixes = [...]string{
	"/v1/models/",
	"/v1/chat/completions/",
	"/v1/responses/",
	"/v1/messages/",
}

var hopByHopHeaders = [...]string{
	"Connection",
	"Keep-Alive",
	"Proxy-Authenticate",
	"Proxy-Authorization",
	"TE",
	"Trailer",
	"Trailers",
	"Transfer-Encoding",
	"Upgrade",
}

// CallerContext contains identity already authenticated by Main. DefaultProjectID
// is derived by the adapter from the current project-system-token or personal-
// project rules; it is never accepted from an untrusted request header.
type CallerContext struct {
	UserID           int64
	DefaultProjectID int64
}

type CallerContextResolver interface {
	ResolveCurrentCaller(context.Context, *http.Request) (CallerContext, error)
}

type ProjectMembershipChecker interface {
	IsCurrentProjectMember(context.Context, int64, int64) (bool, error)
}

type PublicProjectResolver interface {
	CurrentPublicProjectID(context.Context) (int64, error)
}

type ProjectKeyResolver interface {
	CurrentProjectLLMKey(context.Context, int64) (string, error)
}

// ModelGroupLookup is implemented directly by infra/litellm.Client.
type ModelGroupLookup interface {
	LookupModelGroup(context.Context, string) ([]litellm.ModelGroupInfo, error)
}

type ModelCatalogLookup interface {
	ListModels(context.Context) ([]litellm.ModelRecord, error)
}

type Dependencies struct {
	Callers       CallerContextResolver
	Membership    ProjectMembershipChecker
	PublicProject PublicProjectResolver
	ProjectKeys   ProjectKeyResolver
	Models        ModelGroupLookup
	ModelCatalog  ModelCatalogLookup
	HTTPClient    *http.Client
}

type Config struct {
	PublicPrefix      string
	UpstreamBaseURL   string
	RequestTimeout    time.Duration
	MaxRequestHeaders int64
	MaxRequestBody    int64
	StreamBufferBytes int
}

// Handler is safe for concurrent use when its injected dependencies are safe
// for concurrent use.
type Handler struct {
	publicPrefix      string
	upstream          url.URL
	requestTimeout    time.Duration
	maxRequestHeaders int64
	maxRequestBody    int64
	streamBufferBytes int
	callers           CallerContextResolver
	membership        ProjectMembershipChecker
	publicProject     PublicProjectResolver
	projectKeys       ProjectKeyResolver
	models            ModelGroupLookup
	modelCatalog      ModelCatalogLookup
	httpClient        *http.Client
}

func NewHandler(config Config, dependencies Dependencies) (*Handler, error) {
	if config.PublicPrefix == "" {
		config.PublicPrefix = CurrentPublicPrefix
	}
	if config.RequestTimeout == 0 {
		config.RequestTimeout = defaultRequestTimeout
	}
	if config.MaxRequestHeaders == 0 {
		config.MaxRequestHeaders = defaultMaxHeaderBytes
	}
	if config.MaxRequestBody == 0 {
		config.MaxRequestBody = defaultMaxBodyBytes
	}
	if config.StreamBufferBytes == 0 {
		config.StreamBufferBytes = defaultStreamBuffer
	}

	upstream, ok := parseUpstreamBaseURL(config.UpstreamBaseURL)
	if !ok || !validPublicPrefix(config.PublicPrefix) ||
		config.RequestTimeout <= 0 || config.RequestTimeout > maxRequestTimeout ||
		config.MaxRequestHeaders <= 0 || config.MaxRequestHeaders > maxHeaderBytes ||
		config.MaxRequestBody <= 0 || config.MaxRequestBody > maxBodyBytes ||
		config.StreamBufferBytes < 4<<10 || config.StreamBufferBytes > maxStreamBuffer ||
		dependencies.Callers == nil || dependencies.Membership == nil ||
		dependencies.PublicProject == nil || dependencies.ProjectKeys == nil ||
		dependencies.Models == nil || dependencies.ModelCatalog == nil || dependencies.HTTPClient == nil {
		return nil, ErrInvalidConfiguration
	}

	client := *dependencies.HTTPClient
	client.Timeout = config.RequestTimeout
	client.Jar = nil
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}

	return &Handler{
		publicPrefix:      strings.TrimSuffix(config.PublicPrefix, "/"),
		upstream:          *upstream,
		requestTimeout:    config.RequestTimeout,
		maxRequestHeaders: config.MaxRequestHeaders,
		maxRequestBody:    config.MaxRequestBody,
		streamBufferBytes: config.StreamBufferBytes,
		callers:           dependencies.Callers,
		membership:        dependencies.Membership,
		publicProject:     dependencies.PublicProject,
		projectKeys:       dependencies.ProjectKeys,
		models:            dependencies.Models,
		modelCatalog:      dependencies.ModelCatalog,
		httpClient:        &client,
	}, nil
}

func (h *Handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if h == nil || request == nil || request.URL == nil {
		writeProxyError(writer, http.StatusInternalServerError, "LLM facade is unavailable")
		return
	}
	if request.URL.RawPath != "" {
		writeProxyError(writer, http.StatusForbidden, "Forbidden")
		return
	}
	if requestHeaderBytes(request) > h.maxRequestHeaders {
		writeProxyError(writer, http.StatusRequestHeaderFieldsTooLarge, "Request headers exceed the approved limit")
		return
	}
	endpoint, ok := currentEndpoint(request.URL.Path, h.publicPrefix)
	if !ok {
		writeProxyError(writer, http.StatusForbidden, "Forbidden")
		return
	}

	caller, err := h.callers.ResolveCurrentCaller(request.Context(), request)
	if err != nil || caller.UserID <= 0 || caller.DefaultProjectID <= 0 {
		writeProxyError(writer, http.StatusUnauthorized, "Unauthorized")
		return
	}
	projectID := h.selectProject(request.Context(), request.Header, caller)
	publicProjectID, err := h.publicProject.CurrentPublicProjectID(request.Context())
	if err != nil || publicProjectID <= 0 {
		writeProxyError(writer, http.StatusBadGateway, "LLM routing is unavailable")
		return
	}
	if strings.HasPrefix(endpoint, "/v1/models") {
		h.serveCurrentModels(writer, request, endpoint, projectID, publicProjectID)
		return
	}
	projectKey, err := h.projectKeys.CurrentProjectLLMKey(request.Context(), projectID)
	if err != nil || !validSensitiveValue(projectKey) {
		writeProxyError(writer, http.StatusBadGateway, "LLM routing is unavailable")
		return
	}

	body, err := h.prepareBody(request, projectID, publicProjectID)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errRequestBodyTooLarge) {
			status = http.StatusRequestEntityTooLarge
		} else if errors.Is(err, errUnsupportedRequestBody) {
			status = http.StatusUnsupportedMediaType
		} else if errors.Is(err, errRoutingUnavailable) {
			status = http.StatusBadGateway
		}
		writeProxyError(writer, status, proxyErrorMessage(status))
		return
	}

	requestContext, cancel := context.WithTimeout(request.Context(), h.requestTimeout)
	defer cancel()
	target := h.upstream
	target.Path = strings.TrimSuffix(target.Path, "/") + endpoint
	target.RawPath = ""
	target.RawQuery = request.URL.RawQuery

	upstreamRequest, err := http.NewRequestWithContext(requestContext, request.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		writeProxyError(writer, http.StatusBadRequest, "Invalid request")
		return
	}
	copyRequestHeaders(upstreamRequest.Header, request.Header)
	upstreamRequest.Header.Set("Accept-Encoding", "identity")
	upstreamRequest.Header.Set("Authorization", "Bearer "+projectKey)
	if request.Header.Get("X-Api-Key") != "" {
		upstreamRequest.Header.Set("X-Api-Key", projectKey)
	} else {
		upstreamRequest.Header.Del("X-Api-Key")
	}
	if len(body) > 0 {
		upstreamRequest.ContentLength = int64(len(body))
	}

	response, err := h.httpClient.Do(upstreamRequest)
	if err != nil {
		writeProxyError(writer, http.StatusBadGateway, "LLM upstream is unavailable")
		return
	}
	if response == nil || response.Body == nil {
		writeProxyError(writer, http.StatusBadGateway, "LLM upstream is unavailable")
		return
	}
	defer response.Body.Close()

	copyResponseHeaders(writer.Header(), response.Header)
	writer.Header().Set("Server", "Centry")
	writer.WriteHeader(response.StatusCode)
	_ = copyAndFlush(writer, response.Body, make([]byte, h.streamBufferBytes))
}

type currentModelObject struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`
}

func (h *Handler) serveCurrentModels(
	writer http.ResponseWriter,
	request *http.Request,
	endpoint string,
	projectID int64,
	publicProjectID int64,
) {
	models, err := h.modelCatalog.ListModels(request.Context())
	if err != nil {
		writeProxyError(writer, http.StatusBadGateway, "LLM routing is unavailable")
		return
	}
	targetName := strings.TrimPrefix(endpoint, "/v1/models")
	targetName = strings.TrimPrefix(targetName, "/")
	projectPrefix := strconv.FormatInt(projectID, 10) + "_"
	publicPrefix := strconv.FormatInt(publicProjectID, 10) + "_"
	visible := make([]currentModelObject, 0, len(models))
	for _, model := range models {
		name, ok := currentVisibleModelName(model.ModelName, projectPrefix, publicPrefix)
		if !ok {
			continue
		}
		item := currentModelObject{
			ID:      name,
			Object:  "model",
			Created: 1677610602,
			OwnedBy: "openai",
		}
		if targetName != "" && name == targetName {
			writeProxyJSON(writer, http.StatusOK, item)
			return
		}
		visible = append(visible, item)
	}
	if targetName != "" {
		writeProxyError(writer, http.StatusNotFound, "Error")
		return
	}
	writeProxyJSON(writer, http.StatusOK, struct {
		Data   []currentModelObject `json:"data"`
		Object string               `json:"object"`
	}{Data: visible, Object: "list"})
}

func currentVisibleModelName(name, projectPrefix, publicPrefix string) (string, bool) {
	if !validIdentity(name) {
		return "", false
	}
	if strings.HasPrefix(name, projectPrefix) {
		return strings.TrimPrefix(name, projectPrefix), true
	}
	if strings.HasPrefix(name, publicPrefix) {
		return strings.TrimPrefix(name, publicPrefix), true
	}
	separator := strings.IndexByte(name, '_')
	if separator <= 0 {
		return name, true
	}
	for _, character := range name[:separator] {
		if character < '0' || character > '9' {
			return name, true
		}
	}
	return "", false
}

var (
	errInvalidRequestBody     = errors.New("invalid request body")
	errRequestBodyTooLarge    = errors.New("request body too large")
	errUnsupportedRequestBody = errors.New("unsupported request body")
	errRoutingUnavailable     = errors.New("model routing unavailable")
)

func (h *Handler) prepareBody(request *http.Request, projectID, publicProjectID int64) ([]byte, error) {
	if request.Method != http.MethodPost && request.Method != http.MethodPut && request.Method != http.MethodPatch {
		return nil, nil
	}
	if request.Body == nil || request.Body == http.NoBody || request.ContentLength == 0 {
		return nil, nil
	}
	if request.ContentLength > h.maxRequestBody {
		return nil, errRequestBodyTooLarge
	}
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		// Multipart and form model rewriting remain an explicit PoV gap. They
		// fail closed instead of forwarding an unreviewed credential-bearing body.
		return nil, errUnsupportedRequestBody
	}
	raw, err := io.ReadAll(io.LimitReader(request.Body, h.maxRequestBody+1))
	if err != nil {
		return nil, errInvalidRequestBody
	}
	if int64(len(raw)) > h.maxRequestBody {
		return nil, errRequestBodyTooLarge
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var document map[string]any
	if err := decoder.Decode(&document); err != nil || document == nil {
		return nil, errInvalidRequestBody
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, errInvalidRequestBody
	}
	if value, present := document["model"]; present {
		model, ok := value.(string)
		if !ok || !validIdentity(model) {
			return nil, errInvalidRequestBody
		}
		mapped, err := h.resolveModelName(request.Context(), projectID, publicProjectID, model)
		if err != nil {
			return nil, errRoutingUnavailable
		}
		document["model"] = mapped
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		return nil, errInvalidRequestBody
	}
	if int64(len(encoded)) > h.maxRequestBody {
		return nil, errRequestBodyTooLarge
	}
	return encoded, nil
}

func (h *Handler) selectProject(ctx context.Context, headers http.Header, caller CallerContext) int64 {
	requested := headers.Get("X-Project-Id")
	if requested == "" {
		requested = headers.Get("OpenAI-Organization")
	}
	if candidate, ok := positiveProjectID(requested); ok {
		member, err := h.membership.IsCurrentProjectMember(ctx, caller.UserID, candidate)
		if err == nil && member {
			return candidate
		}
	}
	return caller.DefaultProjectID
}

func (h *Handler) resolveModelName(ctx context.Context, projectID, publicProjectID int64, raw string) (string, error) {
	projectModel := strconv.FormatInt(projectID, 10) + "_" + raw
	found, err := h.modelGroupExists(ctx, projectModel)
	if err != nil {
		return "", err
	}
	if found {
		return projectModel, nil
	}
	if publicProjectID != projectID {
		publicModel := strconv.FormatInt(publicProjectID, 10) + "_" + raw
		found, err = h.modelGroupExists(ctx, publicModel)
		if err != nil {
			return "", err
		}
		if found {
			return publicModel, nil
		}
	}
	return raw, nil
}

func (h *Handler) modelGroupExists(ctx context.Context, name string) (bool, error) {
	groups, err := h.models.LookupModelGroup(ctx, name)
	if err != nil {
		return false, err
	}
	return len(groups) > 0, nil
}

func currentEndpoint(requestPath, publicPrefix string) (string, bool) {
	if !strings.HasPrefix(requestPath, publicPrefix+"/") {
		return "", false
	}
	endpoint := strings.TrimPrefix(requestPath, publicPrefix)
	if _, ok := exactCurrentEndpoints[endpoint]; ok {
		return endpoint, true
	}
	for _, prefix := range currentEndpointPrefixes {
		if strings.HasPrefix(endpoint, prefix) {
			return endpoint, true
		}
	}
	return "", false
}

func copyRequestHeaders(target, source http.Header) {
	copyHeaders(target, source)
	removeHopByHopHeaders(target)
	for _, name := range []string{"Authorization", "X-Api-Key", "Cookie", "Host", "Content-Length"} {
		target.Del(name)
	}
}

func copyResponseHeaders(target, source http.Header) {
	copyHeaders(target, source)
	removeHopByHopHeaders(target)
	for name := range target {
		lower := strings.ToLower(name)
		if strings.HasPrefix(lower, "x-litellm-") || strings.HasPrefix(lower, "llm_provider-") {
			target.Del(name)
		}
	}
}

func copyHeaders(target, source http.Header) {
	for name, values := range source {
		for _, value := range values {
			target.Add(name, value)
		}
	}
}

func removeHopByHopHeaders(headers http.Header) {
	for _, token := range strings.Split(headers.Get("Connection"), ",") {
		if token = strings.TrimSpace(token); token != "" {
			headers.Del(token)
		}
	}
	for _, name := range hopByHopHeaders {
		headers.Del(name)
	}
}

func copyAndFlush(writer http.ResponseWriter, reader io.Reader, buffer []byte) error {
	flusher, _ := writer.(http.Flusher)
	for {
		count, readErr := reader.Read(buffer)
		if count > 0 {
			if _, err := writer.Write(buffer[:count]); err != nil {
				return err
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return nil
			}
			return readErr
		}
	}
}

func requestHeaderBytes(request *http.Request) int64 {
	total := int64(len(request.Host))
	for name, values := range request.Header {
		total += int64(len(name) + 4)
		for _, value := range values {
			total += int64(len(value) + 2)
		}
	}
	return total
}

func positiveProjectID(value string) (int64, bool) {
	value = strings.TrimSpace(value)
	parsed, err := strconv.ParseInt(value, 10, 64)
	return parsed, err == nil && parsed > 0
}

func validSensitiveValue(value string) bool {
	return len(value) > 0 && len(value) <= 64<<10 && utf8.ValidString(value) && !strings.ContainsAny(value, "\x00\r\n")
}

func validIdentity(value string) bool {
	if len(value) == 0 || len(value) > maxIdentityBytes || !utf8.ValidString(value) || strings.TrimSpace(value) != value {
		return false
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return false
		}
	}
	return true
}

func validPublicPrefix(value string) bool {
	return strings.HasPrefix(value, "/") && value != "/" && value == strings.TrimSuffix(value, "/") && path.Clean(value) == value
}

func parseUpstreamBaseURL(raw string) (*url.URL, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed == nil || parsed.Opaque != "" || parsed.User != nil || parsed.Host == "" ||
		parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.RawPath != "" ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return nil, false
	}
	if parsed.Path == "" {
		parsed.Path = "/"
	}
	cleaned := path.Clean(parsed.Path)
	if cleaned != strings.TrimSuffix(parsed.Path, "/") && !(cleaned == "/" && parsed.Path == "/") {
		return nil, false
	}
	parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	return parsed, true
}

func proxyErrorMessage(status int) string {
	switch status {
	case http.StatusRequestEntityTooLarge:
		return "Request body exceeds the approved limit"
	case http.StatusUnsupportedMediaType:
		return "Only application/json request bodies are supported"
	case http.StatusBadGateway:
		return "LLM routing is unavailable"
	default:
		return "Invalid request"
	}
}

func writeProxyError(writer http.ResponseWriter, status int, message string) {
	http.Error(writer, message, status)
}

func writeProxyJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
