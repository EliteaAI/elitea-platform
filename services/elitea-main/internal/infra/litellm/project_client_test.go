package litellm

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestProjectClientUsesCurrentTeamAndKeyContracts(t *testing.T) {
	provider := &testMasterKeyProvider{key: "master-key"}
	var calls atomic.Int32
	expected := []struct {
		method   string
		path     string
		query    string
		body     string
		response string
	}{
		{
			method: http.MethodPost, path: "/team/new",
			body:     `{"team_alias":"project_7","models":["7_*","1_*","external-model"]}`,
			response: `{"team_id":"team-id"}`,
		},
		{
			method: http.MethodGet, path: "/v2/team/list", query: "page=1&page_size=100&team_alias=project_7",
			response: `{"teams":[{"team_id":"other-id","team_alias":"other","models":[]}],"total_pages":2}`,
		},
		{
			method: http.MethodGet, path: "/v2/team/list", query: "page=2&page_size=100&team_alias=project_7",
			response: `{"teams":[{"team_id":"team-id","team_alias":"project_7","models":["7_*"]}],"total_pages":2}`,
		},
		{
			method: http.MethodPost, path: "/team/model/add",
			body:     `{"team_id":"team-id","models":["external-2"]}`,
			response: `{}`,
		},
		{
			method: http.MethodPost, path: "/team/model/delete",
			body:     `{"team_id":"team-id","models":["external-1"]}`,
			response: `{}`,
		},
		{
			method: http.MethodPost, path: "/key/generate",
			body:     `{"key_alias":"project_key_7","team_id":"team-id","models":["all-team-models"]}`,
			response: `{"key":"project-secret"}`,
		},
		{
			method: http.MethodGet, path: "/key/list", query: "page=1&return_full_object=true&size=100&team_id=team-id",
			response: `{"keys":[{"token":"other-token","key_alias":"other","team_id":"team-id"}],"total_pages":2}`,
		},
		{
			method: http.MethodGet, path: "/key/list", query: "page=2&return_full_object=true&size=100&team_id=team-id",
			response: `{"keys":[{"token":"project-token","key_alias":"project_key_7","team_id":"team-id"}],"total_pages":2}`,
		},
		{
			method: http.MethodPost, path: "/key/delete",
			body:     `{"keys":["project-token"]}`,
			response: `{}`,
		},
		{
			method: http.MethodPost, path: "/team/delete",
			body:     `{"team_ids":["team-id"]}`,
			response: `{}`,
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		call := int(calls.Add(1)) - 1
		if call < 0 || call >= len(expected) {
			t.Errorf("unexpected call %d: %s %s", call, request.Method, request.URL.String())
			writer.WriteHeader(http.StatusInternalServerError)
			return
		}
		want := expected[call]
		if request.Method != want.method || request.URL.Path != want.path || request.URL.RawQuery != want.query {
			t.Errorf("call %d = %s %s?%s, want %s %s?%s", call, request.Method, request.URL.Path, request.URL.RawQuery, want.method, want.path, want.query)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer master-key" {
			t.Errorf("call %d Authorization = %q", call, got)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Errorf("call %d read body: %v", call, err)
		}
		if want.body == "" {
			if len(body) != 0 {
				t.Errorf("call %d body = %q, want empty", call, body)
			}
		} else {
			assertClientJSONEqual(t, body, []byte(want.body))
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(writer, want.response)
	}))
	defer server.Close()

	client := newTestClient(t, server.URL, provider, server.Client(), ClientConfig{})
	ctx := context.Background()
	team, err := client.CreateTeam(ctx, "project_7", []string{"7_*", "1_*", "external-model"})
	if err != nil || team.TeamID != "team-id" {
		t.Fatalf("create team = %#v, %v", team, err)
	}
	teams, err := client.ListTeams(ctx, "project_7")
	if err != nil || len(teams) != 2 || teams[1].TeamAlias != "project_7" {
		t.Fatalf("list teams = %#v, %v", teams, err)
	}
	if err := client.AddTeamModels(ctx, "team-id", []string{"external-2"}); err != nil {
		t.Fatalf("add team models: %v", err)
	}
	if err := client.DeleteTeamModels(ctx, "team-id", []string{"external-1"}); err != nil {
		t.Fatalf("delete team models: %v", err)
	}
	generated, err := client.GenerateKey(ctx, KeyGenerateRequest{
		KeyAlias: "project_key_7", TeamID: "team-id", Models: []string{"all-team-models"},
	})
	if err != nil || generated.Key != "project-secret" {
		t.Fatalf("generate key = %#v, %v", generated, err)
	}
	keys, err := client.ListKeys(ctx, "team-id")
	if err != nil || len(keys) != 2 || keys[1].KeyAlias != "project_key_7" || keys[1].Token != "project-token" {
		t.Fatalf("list keys = %#v, %v", keys, err)
	}
	if err := client.DeleteKey(ctx, "project-token"); err != nil {
		t.Fatalf("delete key: %v", err)
	}
	if err := client.DeleteTeam(ctx, "team-id"); err != nil {
		t.Fatalf("delete team: %v", err)
	}
	if got := int(calls.Load()); got != len(expected) {
		t.Fatalf("HTTP calls = %d, want %d", got, len(expected))
	}
	if got := int(provider.calls.Load()); got != len(expected) {
		t.Fatalf("master-key resolutions = %d, want %d", got, len(expected))
	}
}

func TestProjectClientAcceptsCurrentEmptyListsAndOptionalFilters(t *testing.T) {
	provider := &testMasterKeyProvider{key: "master-key"}
	var queries []string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		queries = append(queries, request.URL.RawQuery)
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/v2/team/list":
			_, _ = io.WriteString(writer, `{"teams":[],"total_pages":0}`)
		case "/key/list":
			_, _ = io.WriteString(writer, `{"keys":[],"total_pages":0}`)
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	client := newTestClient(t, server.URL, provider, server.Client(), ClientConfig{})

	teams, teamErr := client.ListTeams(context.Background(), "")
	keys, keyErr := client.ListKeys(context.Background(), "")
	if teamErr != nil || keyErr != nil || teams == nil || keys == nil || len(teams) != 0 || len(keys) != 0 {
		t.Fatalf("empty teams=%#v err=%v keys=%#v err=%v", teams, teamErr, keys, keyErr)
	}
	wantQueries := []string{"page=1&page_size=100", "page=1&return_full_object=true&size=100"}
	if !reflect.DeepEqual(queries, wantQueries) {
		t.Fatalf("queries = %#v, want %#v", queries, wantQueries)
	}
}

func TestProjectClientBoundsCollectionsAndPaginationBeforeFurtherCalls(t *testing.T) {
	provider := &testMasterKeyProvider{key: "master-key"}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(writer, `{"teams":[],"total_pages":101}`)
	}))
	defer server.Close()
	client := newTestClient(t, server.URL, provider, server.Client(), ClientConfig{})

	models := make([]string, maxAdminModelMembershipItems+1)
	for index := range models {
		models[index] = "model"
	}
	if _, err := client.CreateTeam(context.Background(), "project_7", models); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("oversized team models error = %v", err)
	}
	if calls.Load() != 0 || provider.calls.Load() != 0 {
		t.Fatalf("oversized request reached dependency: HTTP=%d key=%d", calls.Load(), provider.calls.Load())
	}
	if _, err := client.ListTeams(context.Background(), "project_7"); !errors.Is(err, ErrResponseTooLarge) {
		t.Fatalf("pagination error = %v", err)
	}
	if calls.Load() != 1 || provider.calls.Load() != 1 {
		t.Fatalf("unbounded pagination made extra calls: HTTP=%d key=%d", calls.Load(), provider.calls.Load())
	}
}

func TestProjectClientRejectsMalformedTypedResponses(t *testing.T) {
	provider := &testMasterKeyProvider{key: "master-key"}
	responses := make(chan string, 4)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(writer, <-responses)
	}))
	defer server.Close()
	client := newTestClient(t, server.URL, provider, server.Client(), ClientConfig{})

	responses <- `{}`
	if _, err := client.CreateTeam(context.Background(), "project_7", []string{"7_*"}); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("missing team ID error = %v", err)
	}
	responses <- `{}`
	if _, err := client.GenerateKey(context.Background(), KeyGenerateRequest{KeyAlias: "project_key_7", TeamID: "team-id"}); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("missing key error = %v", err)
	}
	responses <- `{"teams":null,"total_pages":1}`
	if _, err := client.ListTeams(context.Background(), "project_7"); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("null teams error = %v", err)
	}
	responses <- `{"keys":[],"total_pages":-1}`
	if _, err := client.ListKeys(context.Background(), "team-id"); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("negative pages error = %v", err)
	}
}

func TestProjectClientPreservesCancellationDuringPagination(t *testing.T) {
	provider := &testMasterKeyProvider{key: "master-key"}
	secondPageStarted := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if request.URL.Query().Get("page") == "1" {
			_, _ = io.WriteString(writer, `{"keys":[],"total_pages":2}`)
			return
		}
		close(secondPageStarted)
		<-request.Context().Done()
	}))
	defer server.Close()
	client := newTestClient(t, server.URL, provider, server.Client(), ClientConfig{})

	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := client.ListKeys(ctx, "team-id")
		result <- err
	}()
	select {
	case <-secondPageStarted:
	case <-time.After(time.Second):
		t.Fatal("second page did not start")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled pagination error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("canceled pagination did not return")
	}
}

func TestProjectClientDoesNotLeakKeyTokenInErrors(t *testing.T) {
	const token = "sensitive-project-token"
	provider := &testMasterKeyProvider{key: "master-key"}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusBadGateway)
		_, _ = io.WriteString(writer, `{"detail":"sensitive-project-token"}`)
	}))
	defer server.Close()
	client := newTestClient(t, server.URL, provider, server.Client(), ClientConfig{})

	err := client.DeleteKey(context.Background(), token)
	if !errors.Is(err, ErrUnexpectedStatus) || strings.Contains(err.Error(), token) {
		t.Fatalf("delete error = %v", err)
	}
}
