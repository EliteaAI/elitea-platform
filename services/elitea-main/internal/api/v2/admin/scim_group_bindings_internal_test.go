package admin

// What these tests hold in place on the group-binding surface.
//
// A binding decides which project an identity provider can put people into, so
// the failures that matter are the quiet ones:
//
//   - An UNWIRED surface answering an empty list. "No group is bound" is a
//     sentence an operator acts on; they would author bindings that already
//     exist, or conclude the feature is off while pushes are landing.
//   - A binding accepted with a project or a role that does not exist. It would
//     be refused later, during a push, in a log nobody reads.
//   - A refusal that does not name what was wrong.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/scimdirectory"
)

type stubBindingStore struct {
	groups  []scimdirectory.Group
	created []scimdirectory.Group
	deleted []int64
	err     error
}

func (s *stubBindingStore) ListGroups(
	context.Context, scimdirectory.Filter, int, int,
) ([]scimdirectory.Group, int, error) {
	if s.err != nil {
		return nil, 0, s.err
	}
	return s.groups, len(s.groups), nil
}

func (s *stubBindingStore) CreateBinding(
	_ context.Context, displayName string, projectID int, roleName string,
) (scimdirectory.Group, error) {
	if s.err != nil {
		return scimdirectory.Group{}, s.err
	}
	group := scimdirectory.Group{
		ID: 7, DisplayName: displayName, ProjectID: projectID, RoleName: roleName,
	}
	s.created = append(s.created, group)
	return group, nil
}

func (s *stubBindingStore) UpdateBinding(
	_ context.Context, id int64, displayName string, projectID int, roleName string,
) (scimdirectory.Group, error) {
	if s.err != nil {
		return scimdirectory.Group{}, s.err
	}
	return scimdirectory.Group{
		ID: id, DisplayName: displayName, ProjectID: projectID, RoleName: roleName,
	}, nil
}

func (s *stubBindingStore) DeleteGroup(_ context.Context, id int64) error {
	if s.err != nil {
		return s.err
	}
	s.deleted = append(s.deleted, id)
	return nil
}

func serveBinding(
	t *testing.T, handler *Handler, method, target, body string,
) *httptest.ResponseRecorder {
	t.Helper()
	router := chi.NewRouter()
	router.Get("/bindings", handler.SCIMGroupBindingList)
	router.Post("/bindings", handler.SCIMGroupBindingCreate)
	router.Put("/bindings/{id}", handler.SCIMGroupBindingSave)
	router.Delete("/bindings/{id}", handler.SCIMGroupBindingDelete)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(method, target, strings.NewReader(body)))
	return recorder
}

func bindingBody(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	return body
}

// An unwired surface must not answer "there are no bindings".
func TestAnUnwiredBindingSurfaceRefusesRatherThanReportingNoBindings(t *testing.T) {
	handler := NewHandler(nil)
	for _, call := range []struct{ method, target, body string }{
		{http.MethodGet, "/bindings", ""},
		{http.MethodPost, "/bindings", `{"display_name":"Team","project_id":1,"role_name":"editor"}`},
		{http.MethodPut, "/bindings/7", `{"display_name":"Team","project_id":1,"role_name":"editor"}`},
		{http.MethodDelete, "/bindings/7", ""},
	} {
		recorder := serveBinding(t, handler, call.method, call.target, call.body)
		require.Equal(t, http.StatusServiceUnavailable, recorder.Code, "%s %s", call.method, call.target)
	}
}

func TestABindingIsRefusedWhenItNamesNoProjectOrNoRole(t *testing.T) {
	store := &stubBindingStore{}
	handler := NewHandler(nil, WithSCIMGroupBindings(store))

	for _, body := range []string{
		`{"display_name":"","project_id":1,"role_name":"editor"}`,
		`{"display_name":"Team","role_name":"editor"}`,
		`{"display_name":"Team","project_id":1,"role_name":"  "}`,
	} {
		recorder := serveBinding(t, handler, http.MethodPost, "/bindings", body)
		require.Equal(t, http.StatusBadRequest, recorder.Code, body)
	}
	// None of them reached the store. A refusal that had already written is the
	// state neither screen shows.
	require.Empty(t, store.created)
}

// The store's verdicts are echoed with the value an operator has to change.
func TestTheStoresRefusalsAreNamedOnTheWire(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		err      error
		status   int
		contains string
	}{
		{"unknown project", scimdirectory.UnknownProjectError{ProjectID: 42},
			http.StatusBadRequest, "42"},
		{"missing role", scimdirectory.RoleMissingError{ProjectID: 7, RoleName: "auditor"},
			http.StatusBadRequest, "auditor"},
		{"duplicate name", scimdirectory.ErrConflict, http.StatusConflict, "already uses"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			handler := NewHandler(nil, WithSCIMGroupBindings(&stubBindingStore{err: testCase.err}))
			recorder := serveBinding(t, handler, http.MethodPost, "/bindings",
				`{"display_name":"Team","project_id":7,"role_name":"auditor"}`)

			require.Equal(t, testCase.status, recorder.Code)
			require.Contains(t, bindingBody(t, recorder)["error"], testCase.contains)
		})
	}
}

func TestAListingReportsWhoTheGroupGrantedAndWhoItMerelyFound(t *testing.T) {
	store := &stubBindingStore{groups: []scimdirectory.Group{{
		ID: 7, DisplayName: "Platform Team", ProjectID: 12, ProjectName: "Platform",
		RoleName: "editor",
		Members: []scimdirectory.GroupMember{
			{UserID: 1, UserName: "alice@corp.com", Granted: true},
			{UserID: 2, UserName: "bob@corp.com", Granted: false},
		},
	}}}
	handler := NewHandler(nil, WithSCIMGroupBindings(store))

	recorder := serveBinding(t, handler, http.MethodGet, "/bindings", "")
	require.Equal(t, http.StatusOK, recorder.Code)

	bindings := bindingBody(t, recorder)["bindings"].([]any)
	require.Len(t, bindings, 1)
	binding := bindings[0].(map[string]any)
	// The id is a STRING, as it is on the SCIM resource, so the screen and the
	// identity provider address the same binding the same way.
	require.Equal(t, "7", binding["id"])
	members := binding["members"].([]any)
	require.Equal(t, true, members[0].(map[string]any)["granted"])
	require.Equal(t, false, members[1].(map[string]any)["granted"],
		"a member the group only found must be distinguishable on the screen")
}

func TestDeletingABindingReachesTheStoreAndAnswersNoContent(t *testing.T) {
	store := &stubBindingStore{}
	handler := NewHandler(nil, WithSCIMGroupBindings(store))

	recorder := serveBinding(t, handler, http.MethodDelete, "/bindings/7", "")
	require.Equal(t, http.StatusNoContent, recorder.Code)
	require.Equal(t, []int64{7}, store.deleted)
}
