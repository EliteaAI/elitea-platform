package llmproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/litellm"
)

type callerResolverFunc func(context.Context, *http.Request) (CallerContext, error)

func (function callerResolverFunc) ResolveCurrentCaller(ctx context.Context, request *http.Request) (CallerContext, error) {
	return function(ctx, request)
}

type membershipFunc func(context.Context, int64, int64) (bool, error)

func (function membershipFunc) IsCurrentProjectMember(ctx context.Context, userID, projectID int64) (bool, error) {
	return function(ctx, userID, projectID)
}

type publicProjectFunc func(context.Context) (int64, error)

func (function publicProjectFunc) CurrentPublicProjectID(ctx context.Context) (int64, error) {
	return function(ctx)
}

type projectKeyFunc func(context.Context, int64) (string, error)

func (function projectKeyFunc) CurrentProjectLLMKey(ctx context.Context, projectID int64) (string, error) {
	return function(ctx, projectID)
}

type modelLookupFunc func(context.Context, string) ([]litellm.ModelGroupInfo, error)

func (function modelLookupFunc) LookupModelGroup(ctx context.Context, name string) ([]litellm.ModelGroupInfo, error) {
	return function(ctx, name)
}

type modelCatalogFunc func(context.Context) ([]litellm.ModelRecord, error)

func (function modelCatalogFunc) ListModels(ctx context.Context) ([]litellm.ModelRecord, error) {
	return function(ctx)
}

func TestCurrentEndpointAllowlistMatchesCurrentDataPlane(t *testing.T) {
	t.Parallel()

	allowed := []string{
		"/llm/v1/models",
		"/llm/v1/models/one",
		"/llm/v1/completions",
		"/llm/v1/chat/completions",
		"/llm/v1/chat/completions/one",
		"/llm/v1/responses",
		"/llm/v1/responses/one",
		"/llm/v1/messages",
		"/llm/v1/messages/one",
		"/llm/v1/embeddings",
		"/llm/v1/images/generations",
		"/llm/v1/images/edits",
		"/llm/v1/images/variations",
	}
	for _, requestPath := range allowed {
		if endpoint, ok := currentEndpoint(requestPath, CurrentPublicPrefix); !ok || endpoint != strings.TrimPrefix(requestPath, CurrentPublicPrefix) {
			t.Errorf("currentEndpoint(%q) = %q, %t", requestPath, endpoint, ok)
		}
	}

	denied := []string{
		"/llm",
		"/llm/",
		"/llm/v1/embeddings/one",
		"/llm/v1/images",
		"/llm/team/new",
		"/api/llm/v1/messages",
		"/llm/v1/messagesish",
	}
	for _, requestPath := range denied {
		if endpoint, ok := currentEndpoint(requestPath, CurrentPublicPrefix); ok {
			t.Errorf("currentEndpoint(%q) unexpectedly allowed %q", requestPath, endpoint)
		}
	}
}

func TestProjectSelectionPrefersAuthorizedExplicitHeaderAndFallsBack(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name             string
		xProjectID       string
		organization     string
		member           bool
		membershipError  error
		want             int64
		wantMembershipID int64
	}{
		{name: "x project id wins", xProjectID: "7", organization: "8", member: true, want: 7, wantMembershipID: 7},
		{name: "organization fallback", organization: "8", member: true, want: 8, wantMembershipID: 8},
		{name: "not member", xProjectID: "7", member: false, want: 3, wantMembershipID: 7},
		{name: "membership unavailable", xProjectID: "7", membershipError: errors.New("unavailable"), want: 3, wantMembershipID: 7},
		{name: "malformed header", xProjectID: "not-an-id", want: 3},
		{name: "missing header", want: 3},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			var membershipID int64
			handler := testHandler(t, "https://litellm.example", Dependencies{
				Membership: membershipFunc(func(_ context.Context, userID, projectID int64) (bool, error) {
					if userID != 11 {
						t.Errorf("user id = %d", userID)
					}
					membershipID = projectID
					return test.member, test.membershipError
				}),
			})
			headers := make(http.Header)
			headers.Set("X-Project-Id", test.xProjectID)
			headers.Set("OpenAI-Organization", test.organization)
			got := handler.selectProject(context.Background(), headers, CallerContext{UserID: 11, DefaultProjectID: 3})
			if got != test.want || membershipID != test.wantMembershipID {
				t.Fatalf("selection = %d, membership id = %d; want %d, %d", got, membershipID, test.want, test.wantMembershipID)
			}
		})
	}
}

func TestModelResolutionUsesOwnThenPublicThenRaw(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		found map[string]bool
		want  string
		calls []string
	}{
		{name: "own project", found: map[string]bool{"7_model": true}, want: "7_model", calls: []string{"7_model"}},
		{name: "public project", found: map[string]bool{"1_model": true}, want: "1_model", calls: []string{"7_model", "1_model"}},
		{name: "external raw", found: map[string]bool{}, want: "model", calls: []string{"7_model", "1_model"}},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			var calls []string
			handler := testHandler(t, "https://litellm.example", Dependencies{
				Models: modelLookupFunc(func(_ context.Context, name string) ([]litellm.ModelGroupInfo, error) {
					calls = append(calls, name)
					if test.found[name] {
						return []litellm.ModelGroupInfo{{ModelGroup: name}}, nil
					}
					return []litellm.ModelGroupInfo{}, nil
				}),
			})
			got, err := handler.resolveModelName(context.Background(), 7, 1, "model")
			if err != nil || got != test.want || !reflect.DeepEqual(calls, test.calls) {
				t.Fatalf("resolve = %q, %v, calls %v; want %q, %v", got, err, calls, test.want, test.calls)
			}
		})
	}
}

func TestHandlerFiltersCurrentModelsWithoutProjectKeyOrDataPlaneCall(t *testing.T) {
	t.Parallel()

	projectKeyCalls := 0
	upstreamCalls := 0
	handler := testHandler(t, "https://litellm.example", Dependencies{
		Callers: callerResolverFunc(func(context.Context, *http.Request) (CallerContext, error) {
			return CallerContext{UserID: 11, DefaultProjectID: 7}, nil
		}),
		PublicProject: publicProjectFunc(func(context.Context) (int64, error) { return 1, nil }),
		ProjectKeys: projectKeyFunc(func(context.Context, int64) (string, error) {
			projectKeyCalls++
			return "must-not-be-read", nil
		}),
		ModelCatalog: modelCatalogFunc(func(context.Context) ([]litellm.ModelRecord, error) {
			return []litellm.ModelRecord{
				{ModelName: "7_private"},
				{ModelName: "1_shared"},
				{ModelName: "8_hidden"},
				{ModelName: "external_model"},
			}, nil
		}),
		HTTPClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			upstreamCalls++
			return nil, errors.New("must not call data plane")
		})},
	})

	request := httptest.NewRequest(http.MethodGet, "/llm/v1/models", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || projectKeyCalls != 0 || upstreamCalls != 0 {
		t.Fatalf("status=%d key_calls=%d upstream_calls=%d body=%s", response.Code, projectKeyCalls, upstreamCalls, response.Body.String())
	}
	var list struct {
		Data []currentModelObject `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	want := []currentModelObject{
		{ID: "private", Object: "model", Created: 1677610602, OwnedBy: "openai"},
		{ID: "shared", Object: "model", Created: 1677610602, OwnedBy: "openai"},
		{ID: "external_model", Object: "model", Created: 1677610602, OwnedBy: "openai"},
	}
	if !reflect.DeepEqual(list.Data, want) {
		t.Fatalf("models=%+v want=%+v", list.Data, want)
	}

	details := httptest.NewRecorder()
	handler.ServeHTTP(details, httptest.NewRequest(http.MethodGet, "/llm/v1/models/shared", nil))
	if details.Code != http.StatusOK || !strings.Contains(details.Body.String(), `"id":"shared"`) {
		t.Fatalf("details status=%d body=%s", details.Code, details.Body.String())
	}

	missing := httptest.NewRecorder()
	handler.ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/llm/v1/models/hidden", nil))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing status=%d body=%s", missing.Code, missing.Body.String())
	}
}

func TestHandlerSubstitutesProjectKeyRewritesModelAndStreams(t *testing.T) {
	t.Parallel()

	type observation struct {
		method  string
		path    string
		query   string
		headers http.Header
		body    map[string]any
	}
	observed := make(chan observation, 1)
	release := make(chan struct{})
	transport := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		body, _ := io.ReadAll(request.Body)
		var document map[string]any
		_ = json.Unmarshal(body, &document)
		observed <- observation{
			method:  request.Method,
			path:    request.URL.Path,
			query:   request.URL.RawQuery,
			headers: request.Header.Clone(),
			body:    document,
		}
		reader, writer := io.Pipe()
		go func() {
			_, _ = io.WriteString(writer, "data: first\n\n")
			<-release
			_, _ = io.WriteString(writer, "data: second\n\n")
			_ = writer.Close()
		}()
		return &http.Response{
			StatusCode: http.StatusCreated,
			Header: http.Header{
				"Content-Type":       []string{"text/event-stream"},
				"X-LiteLLM-Secret":   []string{"must-not-escape"},
				"Llm_provider-Route": []string{"must-not-escape"},
				"X-Visible":          []string{"yes"},
				"Server":             []string{"upstream"},
			},
			Body:    reader,
			Request: request,
		}, nil
	})

	var lookupMu sync.Mutex
	var lookups []string
	handler := testHandler(t, "https://litellm.example", Dependencies{
		Callers: callerResolverFunc(func(context.Context, *http.Request) (CallerContext, error) {
			return CallerContext{UserID: 11, DefaultProjectID: 3}, nil
		}),
		Membership: membershipFunc(func(_ context.Context, userID, projectID int64) (bool, error) {
			return userID == 11 && projectID == 7, nil
		}),
		PublicProject: publicProjectFunc(func(context.Context) (int64, error) { return 1, nil }),
		ProjectKeys: projectKeyFunc(func(_ context.Context, projectID int64) (string, error) {
			if projectID != 7 {
				t.Errorf("project key requested for %d", projectID)
			}
			return "project-key-7", nil
		}),
		Models: modelLookupFunc(func(_ context.Context, name string) ([]litellm.ModelGroupInfo, error) {
			lookupMu.Lock()
			lookups = append(lookups, name)
			lookupMu.Unlock()
			return []litellm.ModelGroupInfo{{ModelGroup: name}}, nil
		}),
		HTTPClient: &http.Client{Transport: transport},
	})

	request, err := http.NewRequest(
		http.MethodPost,
		"https://elitea.example/llm/v1/chat/completions?trace=one",
		strings.NewReader(`{"model":"claude","temperature":0.25}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer caller-token")
	request.Header.Set("X-Api-Key", "caller-api-key")
	request.Header.Set("X-Project-Id", "7")
	request.Header.Set("OpenAI-Organization", "8")
	request.Header.Set("Connection", "keep-alive, X-Remove-Me")
	request.Header.Set("X-Remove-Me", "remove")
	request.Header.Set("Cookie", "session=remove")

	response := newStreamingRecorder()
	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(response, request)
		close(done)
	}()

	select {
	case first := <-response.writes:
		if string(first) != "data: first\n\n" {
			t.Fatalf("first streamed frame = %q", first)
		}
	case <-time.After(time.Second):
		t.Fatal("first upstream frame was buffered")
	}
	status, responseHeaders := response.snapshot()
	if status != http.StatusCreated {
		t.Fatalf("status = %d", status)
	}
	if responseHeaders.Get("X-LiteLLM-Secret") != "" || responseHeaders.Get("llm_provider-route") != "" ||
		responseHeaders.Get("X-Visible") != "yes" || responseHeaders.Get("Server") != "Centry" {
		t.Fatalf("response headers = %#v", responseHeaders)
	}
	select {
	case got := <-observed:
		if got.method != http.MethodPost || got.path != "/v1/chat/completions" || got.query != "trace=one" {
			t.Errorf("upstream target = %s %s?%s", got.method, got.path, got.query)
		}
		if got.headers.Get("Authorization") != "Bearer project-key-7" || got.headers.Get("X-Api-Key") != "project-key-7" {
			t.Errorf("project key substitution failed: %#v", got.headers)
		}
		for _, name := range []string{"Connection", "X-Remove-Me", "Cookie", "Proxy-Authorization"} {
			if got.headers.Get(name) != "" {
				t.Errorf("filtered request header %s escaped", name)
			}
		}
		if got.headers.Get("Accept-Encoding") != "identity" || got.body["model"] != "7_claude" || got.body["temperature"] != float64(0.25) {
			t.Errorf("upstream request = headers %#v body %#v", got.headers, got.body)
		}
	case <-time.After(time.Second):
		t.Fatal("upstream request was not observed")
	}
	close(release)
	select {
	case second := <-response.writes:
		if string(second) != "data: second\n\n" {
			t.Fatalf("remaining stream = %q", second)
		}
	case <-time.After(time.Second):
		t.Fatal("second upstream frame was not streamed")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("handler did not finish after upstream EOF")
	}
	lookupMu.Lock()
	defer lookupMu.Unlock()
	if !reflect.DeepEqual(lookups, []string{"7_claude"}) {
		t.Fatalf("model lookups = %v", lookups)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

type streamingRecorder struct {
	mu     sync.Mutex
	header http.Header
	status int
	writes chan []byte
}

func newStreamingRecorder() *streamingRecorder {
	return &streamingRecorder{header: make(http.Header), writes: make(chan []byte, 4)}
}

func (recorder *streamingRecorder) Header() http.Header {
	return recorder.header
}

func (recorder *streamingRecorder) WriteHeader(status int) {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	if recorder.status == 0 {
		recorder.status = status
	}
}

func (recorder *streamingRecorder) Write(value []byte) (int, error) {
	recorder.mu.Lock()
	if recorder.status == 0 {
		recorder.status = http.StatusOK
	}
	recorder.mu.Unlock()
	recorder.writes <- bytes.Clone(value)
	return len(value), nil
}

func (*streamingRecorder) Flush() {}

func (recorder *streamingRecorder) snapshot() (int, http.Header) {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	return recorder.status, recorder.header.Clone()
}

func TestRequestBodyBoundsAndUnsupportedMultipartFailClosed(t *testing.T) {
	t.Parallel()

	handler := testHandlerWithConfig(t, "https://litellm.example", Config{
		MaxRequestBody: 32,
	}, Dependencies{})

	tooLarge := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", strings.NewReader(strings.Repeat("x", 33)))
	tooLarge.Header.Set("Content-Type", "application/json")
	if _, err := handler.prepareBody(tooLarge, 7, 1); !errors.Is(err, errRequestBodyTooLarge) {
		t.Fatalf("oversized body error = %v", err)
	}

	multipart := httptest.NewRequest(http.MethodPost, "/llm/v1/images/edits", strings.NewReader("multipart body"))
	multipart.Header.Set("Content-Type", "multipart/form-data; boundary=current")
	if _, err := handler.prepareBody(multipart, 7, 1); !errors.Is(err, errUnsupportedRequestBody) {
		t.Fatalf("multipart body error = %v", err)
	}

	malformed := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", strings.NewReader(`{"model":`))
	malformed.Header.Set("Content-Type", "application/json")
	if _, err := handler.prepareBody(malformed, 7, 1); !errors.Is(err, errInvalidRequestBody) {
		t.Fatalf("malformed body error = %v", err)
	}
}

func TestHandlerRejectsEncodedAndNonAllowlistedPathsBeforeDependencies(t *testing.T) {
	t.Parallel()

	var calls int
	handler := testHandler(t, "https://litellm.example", Dependencies{
		Callers: callerResolverFunc(func(context.Context, *http.Request) (CallerContext, error) {
			calls++
			return CallerContext{UserID: 1, DefaultProjectID: 1}, nil
		}),
	})
	for _, target := range []string{"/llm/team/new", "/llm/v1%2fchat/completions"} {
		request := httptest.NewRequest(http.MethodPost, target, bytes.NewReader(nil))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("%s status = %d", target, response.Code)
		}
	}
	if calls != 0 {
		t.Fatalf("dependency calls = %d", calls)
	}
}

func TestEmptyMutationBodyDoesNotRequireContentType(t *testing.T) {
	t.Parallel()

	handler := testHandler(t, "https://litellm.example", Dependencies{})
	request := httptest.NewRequest(http.MethodPost, "/llm/v1/responses/one/cancel", nil)
	if body, err := handler.prepareBody(request, 7, 1); err != nil || body != nil {
		t.Fatalf("empty body = %q, %v", body, err)
	}
}

func TestNewHandlerRejectsIncompleteOrUnboundedConfiguration(t *testing.T) {
	t.Parallel()

	dependencies := defaultTestDependencies()
	for _, config := range []Config{
		{UpstreamBaseURL: ""},
		{UpstreamBaseURL: "https://user:password@litellm.example"},
		{UpstreamBaseURL: "https://litellm.example/path/../admin"},
		{UpstreamBaseURL: "https://litellm.example", PublicPrefix: "/"},
		{UpstreamBaseURL: "https://litellm.example", RequestTimeout: maxRequestTimeout + time.Second},
		{UpstreamBaseURL: "https://litellm.example", MaxRequestHeaders: maxHeaderBytes + 1},
		{UpstreamBaseURL: "https://litellm.example", MaxRequestBody: maxBodyBytes + 1},
		{UpstreamBaseURL: "https://litellm.example", StreamBufferBytes: 1024},
	} {
		if handler, err := NewHandler(config, dependencies); handler != nil || !errors.Is(err, ErrInvalidConfiguration) {
			t.Errorf("NewHandler(%+v) = %#v, %v", config, handler, err)
		}
	}
	if handler, err := NewHandler(Config{UpstreamBaseURL: "https://litellm.example"}, Dependencies{}); handler != nil || !errors.Is(err, ErrInvalidConfiguration) {
		t.Fatalf("NewHandler with missing dependencies = %#v, %v", handler, err)
	}
}

func testHandler(t *testing.T, upstream string, overrides Dependencies) *Handler {
	t.Helper()
	return testHandlerWithConfig(t, upstream, Config{}, overrides)
}

func testHandlerWithConfig(t *testing.T, upstream string, config Config, overrides Dependencies) *Handler {
	t.Helper()
	dependencies := defaultTestDependencies()
	if overrides.Callers != nil {
		dependencies.Callers = overrides.Callers
	}
	if overrides.Membership != nil {
		dependencies.Membership = overrides.Membership
	}
	if overrides.PublicProject != nil {
		dependencies.PublicProject = overrides.PublicProject
	}
	if overrides.ProjectKeys != nil {
		dependencies.ProjectKeys = overrides.ProjectKeys
	}
	if overrides.Models != nil {
		dependencies.Models = overrides.Models
	}
	if overrides.ModelCatalog != nil {
		dependencies.ModelCatalog = overrides.ModelCatalog
	}
	if overrides.HTTPClient != nil {
		dependencies.HTTPClient = overrides.HTTPClient
	}
	config.UpstreamBaseURL = upstream
	handler, err := NewHandler(config, dependencies)
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func defaultTestDependencies() Dependencies {
	return Dependencies{
		Callers: callerResolverFunc(func(context.Context, *http.Request) (CallerContext, error) {
			return CallerContext{UserID: 11, DefaultProjectID: 3}, nil
		}),
		Membership: membershipFunc(func(context.Context, int64, int64) (bool, error) {
			return false, nil
		}),
		PublicProject: publicProjectFunc(func(context.Context) (int64, error) {
			return 1, nil
		}),
		ProjectKeys: projectKeyFunc(func(context.Context, int64) (string, error) {
			return "project-key", nil
		}),
		Models: modelLookupFunc(func(context.Context, string) ([]litellm.ModelGroupInfo, error) {
			return []litellm.ModelGroupInfo{}, nil
		}),
		ModelCatalog: modelCatalogFunc(func(context.Context) ([]litellm.ModelRecord, error) {
			return []litellm.ModelRecord{}, nil
		}),
		HTTPClient: http.DefaultClient,
	}
}
