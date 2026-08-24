package scim

// What these tests hold in place.
//
// A SCIM client acts on the STATUS and the shape it gets back, and every
// dangerous failure on this surface is one where the shape is fine and the
// meaning is wrong:
//
//   - A filter that was ignored rather than refused: the client asked whether
//     an account exists and was answered about somebody else.
//   - A PATCH that answered 200 without applying its change: the identity
//     provider records the deactivation as done and never sends it again.
//   - A DELETE that answered 204 without revoking access.
//   - A numeric `id`: SCIM ids are strings, and a client that round-trips a
//     JSON number through a float loses large ones.
//
// The directory is a FAKE that records what it was asked to do, so each of
// these is asserted against the call that reached the store, not only against
// the response.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/scimdirectory"
)

type recordingDirectory struct {
	users        map[int]scimdirectory.User
	created      []scimdirectory.User
	replaced     []scimdirectory.User
	activeCalls  []bool
	listedFilter scimdirectory.Filter
	// groups holds the /Groups half of the fake. It is a pointer to a type
	// declared in groups_internal_test.go so the group tests own their own
	// state, and a users test that never touches a group reads unchanged.
	groups *groupState
}

func newRecordingDirectory() *recordingDirectory {
	return &recordingDirectory{groups: newGroupState(), users: map[int]scimdirectory.User{
		42: {
			ID: 42, UserName: "alice@corp.com", DisplayName: "Alice", Active: true,
			ExternalID: "00u1abc", CreatedAt: time.Unix(1, 0), UpdatedAt: time.Unix(2, 0),
		},
	}}
}

func (d *recordingDirectory) List(
	_ context.Context, filter scimdirectory.Filter, _, _ int,
) ([]scimdirectory.User, int, error) {
	d.listedFilter = filter
	users := make([]scimdirectory.User, 0, len(d.users))
	for _, user := range d.users {
		users = append(users, user)
	}
	return users, len(users), nil
}

func (d *recordingDirectory) Get(_ context.Context, id int) (scimdirectory.User, error) {
	user, ok := d.users[id]
	if !ok {
		return scimdirectory.User{}, scimdirectory.ErrNotFound
	}
	return user, nil
}

func (d *recordingDirectory) Create(
	_ context.Context, user scimdirectory.User,
) (scimdirectory.User, error) {
	d.created = append(d.created, user)
	user.ID = 43
	d.users[43] = user
	return user, nil
}

func (d *recordingDirectory) Replace(
	_ context.Context, id int, user scimdirectory.User,
) (scimdirectory.User, error) {
	if _, ok := d.users[id]; !ok {
		return scimdirectory.User{}, scimdirectory.ErrNotFound
	}
	user.ID = id
	d.replaced = append(d.replaced, user)
	d.users[id] = user
	return user, nil
}

func (d *recordingDirectory) SetActive(
	_ context.Context, id int, active bool,
) (scimdirectory.User, error) {
	user, ok := d.users[id]
	if !ok {
		return scimdirectory.User{}, scimdirectory.ErrNotFound
	}
	d.activeCalls = append(d.activeCalls, active)
	user.Active = active
	d.users[id] = user
	return user, nil
}

func serve(t *testing.T, directory Directory, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	recorder := httptest.NewRecorder()
	NewHandler(directory).Routes().ServeHTTP(recorder, request)
	return recorder
}

func decodeBody(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	return body
}

/* ── the filter is refused, never ignored ──────────────────────────────── */

func TestAnUnsupportedFilterIsRefusedWithItsSCIMCode(t *testing.T) {
	directory := newRecordingDirectory()
	recorder := serve(t, directory, http.MethodGet,
		`/Users?filter=`+`userName+eq+%22a%22+and+active+eq+true`, "")

	require.Equal(t, http.StatusBadRequest, recorder.Code)
	body := decodeBody(t, recorder)
	// `invalidFilter` is the code a client switches on. Prose alone makes this
	// indistinguishable from a malformed request.
	require.Equal(t, "invalidFilter", body["scimType"])
	// And the store was never asked: an ignored filter is the defect.
	require.Nil(t, directory.created)
}

func TestASupportedFilterReachesTheStore(t *testing.T) {
	directory := newRecordingDirectory()
	recorder := serve(t, directory, http.MethodGet, `/Users?filter=userName+eq+%22alice@corp.com%22`, "")

	require.Equal(t, http.StatusOK, recorder.Code)
	body := decodeBody(t, recorder)
	// Capital R. A client that looks for `resources` finds nothing, which reads
	// to it as an empty directory rather than as a malformed response.
	require.Contains(t, body, "Resources")
	require.EqualValues(t, 1, body["totalResults"])
}

/* ── the resource shape ────────────────────────────────────────────────── */

func TestTheIDIsAString(t *testing.T) {
	recorder := serve(t, newRecordingDirectory(), http.MethodGet, "/Users/42", "")

	require.Equal(t, http.StatusOK, recorder.Code)
	body := decodeBody(t, recorder)
	require.Equal(t, "42", body["id"], "a SCIM id is a string; a number round-trips through a float")
	require.Equal(t, contentType, recorder.Header().Get("Content-Type"))
}

// An empty externalId is OMITTED rather than sent as "". A client that reads
// back an empty value may take it as an instruction to clear its own mapping.
func TestAnAbsentExternalIDIsOmitted(t *testing.T) {
	directory := newRecordingDirectory()
	directory.users[42] = scimdirectory.User{ID: 42, UserName: "alice@corp.com", Active: true}

	body := decodeBody(t, serve(t, directory, http.MethodGet, "/Users/42", ""))
	require.NotContains(t, body, "externalId")
}

func TestAnUnknownUserIsNotFound(t *testing.T) {
	recorder := serve(t, newRecordingDirectory(), http.MethodGet, "/Users/999", "")
	require.Equal(t, http.StatusNotFound, recorder.Code)
}

/* ── create ────────────────────────────────────────────────────────────── */

// A create with no `active` means active. Defaulting to suspended would create
// every account locked out, and an identity provider pushing a new joiner
// rarely states the flag.
func TestACreateWithNoActiveFlagIsActive(t *testing.T) {
	directory := newRecordingDirectory()
	recorder := serve(t, directory, http.MethodPost, "/Users",
		`{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],
		  "userName":"bob@corp.com","displayName":"Bob"}`)

	require.Equal(t, http.StatusCreated, recorder.Code)
	require.Len(t, directory.created, 1)
	require.True(t, directory.created[0].Active)
	require.Equal(t, BasePath+"/Users/43", recorder.Header().Get("Location"))
}

// The handler must carry the DISTINCTION down, not just the value. Without
// ActiveStated the store cannot tell an omitted flag from an explicit one.
func TestTheHandlerReportsWhetherActiveWasStated(t *testing.T) {
	directory := newRecordingDirectory()
	serve(t, directory, http.MethodPost, "/Users", `{"userName":"bob@corp.com"}`)
	require.Len(t, directory.created, 1)
	require.False(t, directory.created[0].ActiveStated,
		"an omitted active must not read as a statement about the person")

	directory = newRecordingDirectory()
	serve(t, directory, http.MethodPost, "/Users", `{"userName":"bob@corp.com","active":true}`)
	require.True(t, directory.created[0].ActiveStated)
	require.True(t, directory.created[0].Active)
}

// Entra ID sends a `userName` that is a UPN and the routable address as the
// primary email. A create with no userName at all must still resolve one.
func TestAPrimaryEmailStandsInForAMissingUserName(t *testing.T) {
	directory := newRecordingDirectory()
	recorder := serve(t, directory, http.MethodPost, "/Users",
		`{"emails":[{"value":"secondary@corp.com"},{"value":"bob@corp.com","primary":true}]}`)

	require.Equal(t, http.StatusCreated, recorder.Code)
	require.Equal(t, "bob@corp.com", directory.created[0].UserName)
}

// Attributes this platform stores nowhere are DROPPED, not refused. RFC 7643
// requires a service provider to accept a resource carrying attributes it does
// not support, and refusing would break provisioning from every identity
// provider that sends its full default profile.
func TestUnsupportedAttributesDoNotFailTheCreate(t *testing.T) {
	directory := newRecordingDirectory()
	recorder := serve(t, directory, http.MethodPost, "/Users",
		`{"userName":"bob@corp.com","title":"Engineer","phoneNumbers":[{"value":"+1"}],
		  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User":{"department":"R&D"}}`)

	require.Equal(t, http.StatusCreated, recorder.Code)
}

func TestACreateWithNoAddressIsRefused(t *testing.T) {
	recorder := serve(t, newRecordingDirectory(), http.MethodPost, "/Users", `{"displayName":"Bob"}`)

	require.Equal(t, http.StatusBadRequest, recorder.Code)
	require.Equal(t, "invalidValue", decodeBody(t, recorder)["scimType"])
}

/* ── PATCH: both shapes in the wild ────────────────────────────────────── */

// The Okta shape.
func TestAPathedActivePatchIsApplied(t *testing.T) {
	directory := newRecordingDirectory()
	recorder := serve(t, directory, http.MethodPatch, "/Users/42",
		`{"schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
		  "Operations":[{"op":"replace","path":"active","value":false}]}`)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, []bool{false}, directory.activeCalls)
}

// The Entra ID shape: no path, the attributes in an object. A handler that only
// knew the shape above would silently ignore every deactivation from it.
func TestAPathlessActivePatchIsApplied(t *testing.T) {
	directory := newRecordingDirectory()
	recorder := serve(t, directory, http.MethodPatch, "/Users/42",
		`{"Operations":[{"op":"Replace","value":{"active":false}}]}`)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, []bool{false}, directory.activeCalls)
}

// Some clients send the string "False". Refusing it would leave the account
// active after the provider believed it had deactivated it.
func TestAStringBooleanIsAccepted(t *testing.T) {
	directory := newRecordingDirectory()
	recorder := serve(t, directory, http.MethodPatch, "/Users/42",
		`{"Operations":[{"op":"replace","path":"active","value":"False"}]}`)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, []bool{false}, directory.activeCalls)
}

// A PATCH of an attribute this directory cannot apply is REFUSED, and the
// refusal names the path. Answering 200 would tell the identity provider that
// the rename took effect, and it would never send it again.
func TestAPatchOfAnotherAttributeIsRefusedRatherThanDropped(t *testing.T) {
	directory := newRecordingDirectory()
	recorder := serve(t, directory, http.MethodPatch, "/Users/42",
		`{"Operations":[{"op":"replace","path":"displayName","value":"Alicia"}]}`)

	require.Equal(t, http.StatusNotImplemented, recorder.Code)
	require.Empty(t, directory.activeCalls)
	require.Contains(t, decodeBody(t, recorder)["detail"], "displayName")
}

// A `remove` is not applied either, and is not silently treated as a replace.
func TestARemoveOperationIsRefused(t *testing.T) {
	directory := newRecordingDirectory()
	recorder := serve(t, directory, http.MethodPatch, "/Users/42",
		`{"Operations":[{"op":"remove","path":"active"}]}`)

	require.Equal(t, http.StatusNotImplemented, recorder.Code)
	require.Empty(t, directory.activeCalls)
}

// A pathless operation carrying only attributes this service does not store is
// understood and changes nothing. Refusing it would stop a provider whose
// profile update happens to travel with the deactivation this handler exists to
// apply.
func TestAPathlessPatchWithNothingToApplyReturnsTheResourceUnchanged(t *testing.T) {
	directory := newRecordingDirectory()
	recorder := serve(t, directory, http.MethodPatch, "/Users/42",
		`{"Operations":[{"op":"replace","value":{"title":"Engineer"}}]}`)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Empty(t, directory.activeCalls)
	require.Equal(t, true, decodeBody(t, recorder)["active"])
}

/* ── DELETE deactivates ────────────────────────────────────────────────── */

// A DELETE must revoke access. It does NOT remove the row — see the file header
// of users.go — and the test asserts the revocation actually reached the store,
// because a 204 with nothing behind it is the failure that matters here.
func TestADeleteDeactivatesRatherThanAnsweringWithNothingBehindIt(t *testing.T) {
	directory := newRecordingDirectory()
	recorder := serve(t, directory, http.MethodDelete, "/Users/42", "")

	require.Equal(t, http.StatusNoContent, recorder.Code)
	require.Equal(t, []bool{false}, directory.activeCalls)
	require.False(t, directory.users[42].Active)
}

/* ── the surfaces that declare what this is ────────────────────────────── */

// The configuration document must report what this handler DOES. One that
// over-reports is how a client comes to send requests the server then fails.
func TestTheServiceProviderConfigReportsWhatIsImplemented(t *testing.T) {
	body := decodeBody(t, serve(t, newRecordingDirectory(), http.MethodGet, "/ServiceProviderConfig", ""))

	require.Equal(t, true, body["patch"].(map[string]any)["supported"])
	require.Equal(t, true, body["filter"].(map[string]any)["supported"])
	require.Equal(t, false, body["bulk"].(map[string]any)["supported"])
	require.Equal(t, false, body["sort"].(map[string]any)["supported"])
	require.Equal(t, false, body["changePassword"].(map[string]any)["supported"])
}

// ResourceTypes and the group catalogue moved to groups_internal_test.go when
// /Groups became a served resource. What is asserted there is the same rule
// read the other way round: the catalogue lists what this tree answers, so a
// client neither misses a resource nor discovers one that refuses everything.

/* ── an unwired handler refuses ────────────────────────────────────────── */

// A SCIM client treats a 2xx as done. An unwired handler answering an empty
// list would tell an identity provider that this deployment has no users and
// that every deactivation had already been applied.
func TestAnUnwiredDirectoryRefusesRatherThanAnsweringEmpty(t *testing.T) {
	recorder := serve(t, nil, http.MethodGet, "/Users", "")
	require.Equal(t, http.StatusServiceUnavailable, recorder.Code)
}
