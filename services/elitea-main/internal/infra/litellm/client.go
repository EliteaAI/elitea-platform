package litellm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	defaultAdminRequestTimeout  = 30 * time.Second
	minAdminRequestTimeout      = time.Second
	maxAdminRequestTimeout      = 30 * time.Second
	defaultAdminRequestBytes    = int64(1 << 20)
	minAdminRequestBytes        = int64(4 << 10)
	maxAdminRequestBytes        = int64(4 << 20)
	defaultAdminResponseBytes   = int64(4 << 20)
	minAdminResponseBytes       = int64(4 << 10)
	maxAdminResponseBytes       = int64(16 << 20)
	maxAdminIdentifierBytes     = 4096
	maxAdminSameOriginRedirects = 10
)

var (
	ErrInvalidClientConfiguration = errors.New("litellm: invalid client configuration")
	ErrInvalidRequest             = errors.New("litellm: invalid request")
	ErrMasterKeyUnavailable       = errors.New("litellm: master key unavailable")
	ErrRequestTooLarge            = errors.New("litellm: request body too large")
	ErrRequestFailed              = errors.New("litellm: request failed")
	ErrRedirectRejected           = errors.New("litellm: redirect rejected")
	ErrUnexpectedStatus           = errors.New("litellm: unexpected response status")
	ErrResponseTooLarge           = errors.New("litellm: response body too large")
	ErrInvalidResponse            = errors.New("litellm: invalid response")
)

// MasterKeyProvider resolves the LiteLLM administrative master key for one
// request. Implementations must honor ctx and must not include the key in
// returned errors. Client never stores the resolved key.
type MasterKeyProvider interface {
	MasterKey(ctx context.Context) (string, error)
}

// ClientConfig contains only non-secret transport policy. Zero-valued limits
// use the bounded defaults declared above.
type ClientConfig struct {
	BaseURL          string
	RequestTimeout   time.Duration
	MaxRequestBytes  int64
	MaxResponseBytes int64
}

// CredentialRecord is the masked credential shape returned by GET
// /credentials. LiteLLM masks credential_values before returning them.
type CredentialRecord struct {
	CredentialName   string         `json:"credential_name"`
	CredentialValues map[string]any `json:"credential_values"`
	CredentialInfo   map[string]any `json:"credential_info"`
}

// ModelRecord is one deployment returned by GET /model/info.
type ModelRecord struct {
	ModelName     string         `json:"model_name"`
	LiteLLMParams map[string]any `json:"litellm_params"`
	ModelInfo     map[string]any `json:"model_info"`
}

// ModelGroupInfo contains the stable identity fields needed by the current
// project-first, public-second, external-name model resolution algorithm.
// Additional LiteLLM capability fields are deliberately ignored.
type ModelGroupInfo struct {
	ModelGroup string   `json:"model_group"`
	Providers  []string `json:"providers"`
}

// Client is safe for concurrent use when its injected dependencies are safe
// for concurrent use. It performs no retries: callers own durable reconciliation
// because a timeout after dispatch can have an unknown external outcome.
type Client struct {
	baseURL          url.URL
	masterKey        MasterKeyProvider
	httpClient       *http.Client
	requestTimeout   time.Duration
	maxRequestBytes  int64
	maxResponseBytes int64
}

// NewClient creates a bounded client for the current LiteLLM administrative
// endpoints. The base URL must be an HTTP(S) origin without credentials, query,
// fragment, or deployment path. The supplied HTTP client is copied so the
// caller's redirect and timeout policy is not mutated.
func NewClient(config ClientConfig, masterKey MasterKeyProvider, httpClient *http.Client) (*Client, error) {
	baseURL, ok := parseAdminBaseURL(config.BaseURL)
	if !ok || masterKey == nil || httpClient == nil {
		return nil, ErrInvalidClientConfiguration
	}

	if config.RequestTimeout == 0 {
		config.RequestTimeout = defaultAdminRequestTimeout
	}
	if config.RequestTimeout < minAdminRequestTimeout || config.RequestTimeout > maxAdminRequestTimeout {
		return nil, ErrInvalidClientConfiguration
	}
	if config.MaxRequestBytes == 0 {
		config.MaxRequestBytes = defaultAdminRequestBytes
	}
	if config.MaxRequestBytes < minAdminRequestBytes || config.MaxRequestBytes > maxAdminRequestBytes {
		return nil, ErrInvalidClientConfiguration
	}
	if config.MaxResponseBytes == 0 {
		config.MaxResponseBytes = defaultAdminResponseBytes
	}
	if config.MaxResponseBytes < minAdminResponseBytes || config.MaxResponseBytes > maxAdminResponseBytes {
		return nil, ErrInvalidClientConfiguration
	}

	clientCopy := *httpClient
	clientCopy.Timeout = config.RequestTimeout
	// Administrative calls authenticate only with the per-request master key;
	// do not forward cookies from a shared caller-owned client.
	clientCopy.Jar = nil
	clientCopy.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if request == nil || request.URL == nil ||
			!sameAdminOrigin(*baseURL, *request.URL) || len(via) >= maxAdminSameOriginRedirects {
			return ErrRedirectRejected
		}
		return nil
	}

	return &Client{
		baseURL:          *baseURL,
		masterKey:        masterKey,
		httpClient:       &clientCopy,
		requestTimeout:   config.RequestTimeout,
		maxRequestBytes:  config.MaxRequestBytes,
		maxResponseBytes: config.MaxResponseBytes,
	}, nil
}

func (c *Client) CreateCredential(ctx context.Context, credential CredentialProjection) error {
	if !validAdminIdentifier(credential.CredentialName) ||
		credential.CredentialValues == nil || credential.CredentialInfo == nil {
		return ErrInvalidRequest
	}
	return c.mutate(ctx, "credential create", http.MethodPost, "/credentials", "", nil, credential)
}

func (c *Client) ListCredentials(ctx context.Context) ([]CredentialRecord, error) {
	var envelope struct {
		Credentials *[]CredentialRecord `json:"credentials"`
	}
	if err := c.doJSON(ctx, "credential list", http.MethodGet, "/credentials", "", nil, nil, &envelope); err != nil {
		return nil, err
	}
	if envelope.Credentials == nil {
		return nil, ErrInvalidResponse
	}
	return *envelope.Credentials, nil
}

func (c *Client) DeleteCredential(ctx context.Context, credentialName string) error {
	if !validAdminIdentifier(credentialName) {
		return ErrInvalidRequest
	}
	path := "/credentials/" + credentialName
	rawPath := "/credentials/" + url.PathEscape(credentialName)
	return c.mutate(ctx, "credential delete", http.MethodDelete, path, rawPath, nil, nil)
}

func (c *Client) CreateModel(ctx context.Context, model ModelProjection) error {
	if !validAdminIdentifier(model.ModelName) || model.LiteLLMParams == nil || model.ModelInfo == nil {
		return ErrInvalidRequest
	}
	return c.mutate(ctx, "model create", http.MethodPost, "/model/new", "", nil, model)
}

func (c *Client) ListModels(ctx context.Context) ([]ModelRecord, error) {
	var envelope struct {
		Data *[]ModelRecord `json:"data"`
	}
	if err := c.doJSON(ctx, "model list", http.MethodGet, "/model/info", "", nil, nil, &envelope); err != nil {
		return nil, err
	}
	if envelope.Data == nil {
		return nil, ErrInvalidResponse
	}
	return *envelope.Data, nil
}

func (c *Client) DeleteModel(ctx context.Context, modelID string) error {
	if !validAdminIdentifier(modelID) {
		return ErrInvalidRequest
	}
	payload := struct {
		ID string `json:"id"`
	}{ID: modelID}
	return c.mutate(ctx, "model delete", http.MethodPost, "/model/delete", "", nil, payload)
}

// LookupModelGroup calls the list-shaped current endpoint with an exact
// model_group query. A missing group is returned as an empty slice.
func (c *Client) LookupModelGroup(ctx context.Context, modelGroup string) ([]ModelGroupInfo, error) {
	if !validAdminIdentifier(modelGroup) {
		return nil, ErrInvalidRequest
	}
	var envelope struct {
		Data *[]ModelGroupInfo `json:"data"`
	}
	query := url.Values{"model_group": []string{modelGroup}}
	if err := c.doJSON(ctx, "model group lookup", http.MethodGet, "/model_group/info", "", query, nil, &envelope); err != nil {
		return nil, err
	}
	if envelope.Data == nil {
		return nil, ErrInvalidResponse
	}
	return *envelope.Data, nil
}

func (c *Client) mutate(
	ctx context.Context,
	operation, method, path, rawPath string,
	query url.Values,
	payload any,
) error {
	var response json.RawMessage
	return c.doJSON(ctx, operation, method, path, rawPath, query, payload, &response)
}

func (c *Client) doJSON(
	ctx context.Context,
	operation, method, path, rawPath string,
	query url.Values,
	payload any,
	target any,
) error {
	if ctx == nil || c == nil || target == nil {
		return ErrInvalidRequest
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	requestContext, cancel := context.WithTimeout(ctx, c.requestTimeout)
	defer cancel()

	var requestBody []byte
	var err error
	if payload != nil {
		requestBody, err = json.Marshal(payload)
		if err != nil {
			return ErrInvalidRequest
		}
		defer clearAdminBytes(requestBody)
		if int64(len(requestBody)) > c.maxRequestBytes {
			return ErrRequestTooLarge
		}
	}

	masterKey, err := c.masterKey.MasterKey(requestContext)
	if err != nil {
		if contextErr := requestContext.Err(); contextErr != nil {
			return contextErr
		}
		return ErrMasterKeyUnavailable
	}
	if !validMasterKey(masterKey) {
		return ErrMasterKeyUnavailable
	}

	endpoint := c.baseURL
	endpoint.Path = path
	endpoint.RawPath = rawPath
	endpoint.RawQuery = query.Encode()

	var body io.Reader
	if requestBody != nil {
		body = bytes.NewReader(requestBody)
	}
	request, err := http.NewRequestWithContext(requestContext, method, endpoint.String(), body)
	if err != nil {
		return ErrInvalidRequest
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+masterKey)
	defer request.Header.Del("Authorization")

	response, err := c.httpClient.Do(request)
	if err != nil {
		if response != nil && response.Body != nil {
			_ = response.Body.Close()
		}
		if errors.Is(err, ErrRedirectRejected) {
			return ErrRedirectRejected
		}
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
		if contextErr := requestContext.Err(); contextErr != nil {
			return contextErr
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return context.DeadlineExceeded
		}
		return fmt.Errorf("%w: %s", ErrRequestFailed, operation)
	}
	if response == nil || response.Body == nil {
		return fmt.Errorf("%w: %s", ErrRequestFailed, operation)
	}

	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, c.maxResponseBytes+1))
	defer clearAdminBytes(responseBody)
	closeErr := response.Body.Close()
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	if contextErr := requestContext.Err(); contextErr != nil {
		return contextErr
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("%w: %s status %d", ErrUnexpectedStatus, operation, response.StatusCode)
	}
	if int64(len(responseBody)) > c.maxResponseBytes {
		return ErrResponseTooLarge
	}
	if readErr != nil || closeErr != nil {
		return fmt.Errorf("%w: %s", ErrRequestFailed, operation)
	}
	if !jsonContentType(response.Header.Values("Content-Type")) {
		return ErrInvalidResponse
	}
	if err := json.Unmarshal(responseBody, target); err != nil {
		return ErrInvalidResponse
	}
	return nil
}

func parseAdminBaseURL(raw string) (*url.URL, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed == nil || parsed.Opaque != "" || parsed.User != nil ||
		parsed.Host == "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		(parsed.Path != "" && parsed.Path != "/") || parsed.RawPath != "" {
		return nil, false
	}
	if parsed.Hostname() == "" {
		return nil, false
	}
	parsed.Path = ""
	return parsed, true
}

func sameAdminOrigin(expected, actual url.URL) bool {
	return strings.EqualFold(expected.Scheme, actual.Scheme) &&
		strings.EqualFold(expected.Host, actual.Host) && actual.User == nil
}

func validAdminIdentifier(value string) bool {
	if len(value) == 0 || len(value) > maxAdminIdentifierBytes || !utf8.ValidString(value) || strings.TrimSpace(value) != value {
		return false
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return false
		}
	}
	return true
}

func validMasterKey(value string) bool {
	return validAdminIdentifier(value)
}

func jsonContentType(values []string) bool {
	if len(values) != 1 {
		return false
	}
	mediaType, _, err := mime.ParseMediaType(values[0])
	return err == nil && mediaType == "application/json"
}

func clearAdminBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}
