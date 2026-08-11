package currentcore

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/security/securefile"
)

const (
	maxCurrentCoreBaseURLBytes        = 2048
	maxCurrentCoreTokenBytes          = 16 * 1024
	maxNextInputSuggestionPolicyBytes = 4 * 1024
	maxRuntimeCABytes                 = 1 << 20
	defaultRequestTimeout             = 3 * time.Second
)

var ErrNextInputSuggestionPolicyUnavailable = errors.New(
	"current next-input-suggestion policy is unavailable",
)

type ActorTokenIssuer interface {
	IssueToken(context.Context, int64) (string, error)
}

type NextInputSuggestionResolver struct {
	baseURL *url.URL
	issuer  ActorTokenIssuer
	client  *http.Client
	timeout time.Duration
}

func NewNextInputSuggestionResolver(
	baseURL string,
	issuer ActorTokenIssuer,
	client *http.Client,
) (*NextInputSuggestionResolver, error) {
	parsed, err := parseCurrentCoreBaseURL(baseURL)
	if err != nil {
		return nil, err
	}
	if issuer == nil || client == nil || client.Transport == nil {
		return nil, errors.New("current Core policy resolver dependencies are required")
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &NextInputSuggestionResolver{
		baseURL: parsed,
		issuer:  issuer,
		client:  &clientCopy,
		timeout: defaultRequestTimeout,
	}, nil
}

func NewTLSClient(caFile string) (*http.Client, error) {
	contents, err := securefile.Read(caFile, maxRuntimeCABytes, securefile.PublicMaterial)
	if err != nil {
		return nil, fmt.Errorf("load current Core runtime CA: %w", err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(contents) {
		return nil, errors.New("current Core runtime CA file contains no certificates")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DisableCompression = true
	transport.ForceAttemptHTTP2 = true
	transport.MaxIdleConns = 8
	transport.MaxIdleConnsPerHost = 8
	transport.IdleConnTimeout = 30 * time.Second
	transport.ResponseHeaderTimeout = defaultRequestTimeout
	transport.TLSClientConfig = &tls.Config{
		MinVersion: tls.VersionTLS13,
		RootCAs:    roots,
	}
	return &http.Client{Transport: transport}, nil
}

func (resolver *NextInputSuggestionResolver) ResolveNextInputSuggestionPolicy(
	ctx context.Context,
	projectID int64,
	actorUserID int64,
) (json.RawMessage, error) {
	if ctx == nil || projectID <= 0 || actorUserID <= 0 {
		return nil, ErrNextInputSuggestionPolicyUnavailable
	}
	requestContext, cancel := context.WithTimeout(ctx, resolver.timeout)
	defer cancel()

	token, err := resolver.issuer.IssueToken(requestContext, actorUserID)
	if err != nil || !validBearerToken(token) {
		return nil, ErrNextInputSuggestionPolicyUnavailable
	}
	endpoint := *resolver.baseURL
	endpoint.Path = "/api/v2/elitea_core/next_input_suggestion_config/prompt_lib/" +
		strconv.FormatInt(projectID, 10)
	request, err := http.NewRequestWithContext(
		requestContext,
		http.MethodGet,
		endpoint.String(),
		nil,
	)
	if err != nil {
		return nil, ErrNextInputSuggestionPolicyUnavailable
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)

	response, err := resolver.client.Do(request)
	if err != nil {
		return nil, ErrNextInputSuggestionPolicyUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxNextInputSuggestionPolicyBytes))
		return nil, ErrNextInputSuggestionPolicyUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(
		response.Body,
		maxNextInputSuggestionPolicyBytes+1,
	))
	if err != nil || len(body) > maxNextInputSuggestionPolicyBytes || !validJSONObject(body) {
		return nil, ErrNextInputSuggestionPolicyUnavailable
	}
	var policy struct {
		Enabled          bool `json:"enabled"`
		MinResponseChars int  `json:"min_response_chars"`
		TimeoutSeconds   int  `json:"timeout_seconds"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&policy); err != nil ||
		policy.MinResponseChars < 1 || policy.MinResponseChars > 100_000 ||
		policy.TimeoutSeconds < 1 || policy.TimeoutSeconds > 300 {
		return nil, ErrNextInputSuggestionPolicyUnavailable
	}
	canonical, err := json.Marshal(policy)
	if err != nil {
		return nil, ErrNextInputSuggestionPolicyUnavailable
	}
	return canonical, nil
}

func parseCurrentCoreBaseURL(raw string) (*url.URL, error) {
	if raw == "" || len(raw) > maxCurrentCoreBaseURLBytes || strings.TrimSpace(raw) != raw {
		return nil, errors.New("current Core base URL is invalid")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		parsed.ForceQuery || parsed.RawPath != "" || (parsed.Path != "" && parsed.Path != "/") {
		return nil, errors.New("current Core base URL must be an HTTPS origin")
	}
	parsed.Path = ""
	return parsed, nil
}

func validBearerToken(token string) bool {
	return token != "" && len(token) <= maxCurrentCoreTokenBytes && utf8.ValidString(token) &&
		!strings.ContainsAny(token, "\x00\r\n")
}

func validJSONObject(value []byte) bool {
	trimmed := bytes.TrimSpace(value)
	return json.Valid(trimmed) && len(trimmed) >= 2 &&
		trimmed[0] == '{' && trimmed[len(trimmed)-1] == '}'
}
