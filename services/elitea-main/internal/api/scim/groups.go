package scim

// The `/Groups` resource: an identity provider group bound to one project role.
//
// Read the package comment first. It says what this tree is, how a client
// authenticates, and what a SCIM group means on this platform.
//
// # A push carries the members. It never carries the project or the role
//
// `elitea_auth.scim_group_bindings` (shared migration 0097) holds the half a
// SCIM group cannot express, authored by an administrator before any push. So:
//
//   - `POST /Groups` BINDS. A group with no binding is refused by name, with
//     400 and a sentence telling the operator to author one. It does not create
//     a project: provisioning one is a multi-step act with a tenant schema,
//     roles, a machine identity, secrets, buckets and quotas behind it, and an
//     identity provider is not the place that decision is taken.
//   - `DELETE /Groups/{id}` withdraws what the group granted and removes the
//     binding. It does NOT delete the project, for the same reason
//     `DELETE /Users` does not delete an account: the project holds the work of
//     everyone in it.
//   - A member removed from the group loses the role this group gave them, and
//     nothing else. A member somebody added by hand is never touched, and the
//     project owner keeps their role — see internal/scimdirectory/groups.go.
//
// # Refusals name what they refused
//
// An unresolvable member value, an unsupported PATCH path and an unbound group
// are all refused with the value in the message. A 200 that had applied less
// than it said is what this whole surface exists to avoid: an identity provider
// records the operation as done and does not send it again, so a silent partial
// apply is permanent.

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/scimdirectory"
)

// groupBody is the subset of the SCIM Group resource this service reads.
//
// As on the users side, attributes with nowhere to go are dropped rather than
// refused (RFC 7643 §3.3). What must never be dropped is a value this service
// acts on, and those are all here.
type groupBody struct {
	Schemas     []string `json:"schemas"`
	ExternalID  string   `json:"externalId"`
	DisplayName string   `json:"displayName"`
	Members     []struct {
		Value   string `json:"value"`
		Display string `json:"display"`
		Type    string `json:"type"`
	} `json:"members"`
}

/* ── read ──────────────────────────────────────────────────────────────── */

// ListGroups answers `GET /Groups`.
func (h *Handler) ListGroups(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	filter, err := scimdirectory.ParseGroupFilter(r.URL.Query().Get("filter"))
	if err != nil {
		var unsupported scimdirectory.UnsupportedFilterError
		if errors.As(err, &unsupported) {
			writeError(w, http.StatusBadRequest, "invalidFilter", unsupported.Reason)
			return
		}
		writeError(w, http.StatusBadRequest, "invalidFilter", "the filter could not be read")
		return
	}

	startIndex, count := pagination(r)
	groups, total, err := h.directory.ListGroups(r.Context(), filter, startIndex, count)
	if err != nil {
		h.writeGroupFailure(w, err, "list groups")
		return
	}

	resources := make([]any, 0, len(groups))
	for _, group := range groups {
		resources = append(resources, groupResource(group))
	}
	body := listResponse(resources, total, len(resources))
	body["startIndex"] = startIndex
	writeJSON(w, http.StatusOK, body)
}

// GetGroup answers `GET /Groups/{id}`.
func (h *Handler) GetGroup(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	id, ok := groupID(w, r)
	if !ok {
		return
	}
	group, err := h.directory.GetGroup(r.Context(), id)
	if err != nil {
		h.writeGroupFailure(w, err, "read group")
		return
	}
	writeJSON(w, http.StatusOK, groupResource(group))
}

/* ── write ─────────────────────────────────────────────────────────────── */

// CreateGroup answers `POST /Groups`. It binds; it does not provision.
//
// The response is 201 with the binding's id, which is the id the client will
// address for the rest of the group's life. An unbound group is 400: the client
// must not retry it, because no retry will succeed until an administrator has
// authored the binding.
func (h *Handler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	body, ok := decodeGroup(w, r)
	if !ok {
		return
	}
	displayName := strings.TrimSpace(body.DisplayName)
	if displayName == "" {
		writeError(w, http.StatusBadRequest, "invalidValue", "displayName is required")
		return
	}

	group, err := h.directory.LookupGroup(r.Context(), strings.TrimSpace(body.ExternalID), displayName)
	if errors.Is(err, scimdirectory.ErrNoBinding) {
		writeError(w, http.StatusBadRequest, "invalidValue",
			"the group "+strconv.Quote(displayName)+" is not bound to a project on this deployment. "+
				"A SCIM group here grants one project role, and which project and which role are "+
				"authored by an administrator — group provisioning never creates a project. "+
				"Bind the group under Administration, then push it again.")
		return
	}
	if err != nil {
		h.writeGroupFailure(w, err, "look up group binding")
		return
	}

	members, ok := h.resolveMembers(w, r, body)
	if !ok {
		return
	}
	if err := h.directory.AdoptGroup(r.Context(), group.ID, body.ExternalID, displayName); err != nil {
		h.writeGroupFailure(w, err, "adopt group binding")
		return
	}
	// A create states the whole membership, so it REPLACES: a second push of a
	// group that has changed since the first must not leave the people it
	// dropped inside the project.
	group, err = h.directory.ReplaceGroupMembers(r.Context(), group.ID, members)
	if err != nil {
		h.writeGroupFailure(w, err, "apply group members")
		return
	}
	w.Header().Set("Location", BasePath+"/Groups/"+strconv.FormatInt(group.ID, 10))
	writeJSON(w, http.StatusCreated, groupResource(group))
}

// ReplaceGroup answers `PUT /Groups/{id}`: the membership becomes exactly what
// was sent, and a renamed group keeps its binding.
func (h *Handler) ReplaceGroup(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	id, ok := groupID(w, r)
	if !ok {
		return
	}
	body, ok := decodeGroup(w, r)
	if !ok {
		return
	}
	members, ok := h.resolveMembers(w, r, body)
	if !ok {
		return
	}
	if name := strings.TrimSpace(body.DisplayName); name != "" {
		if _, err := h.directory.RenameGroup(r.Context(), id, name); err != nil {
			h.writeGroupFailure(w, err, "rename group")
			return
		}
	}
	group, err := h.directory.ReplaceGroupMembers(r.Context(), id, members)
	if err != nil {
		h.writeGroupFailure(w, err, "replace group members")
		return
	}
	writeJSON(w, http.StatusOK, groupResource(group))
}

// DeleteGroup answers `DELETE /Groups/{id}`.
//
// It withdraws the access this group granted and removes the binding. The
// project, its content and every member it did not grant survive. An
// administrator who wants the project gone deletes it from the admin Projects
// page, where the consequences are on screen.
func (h *Handler) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	id, ok := groupID(w, r)
	if !ok {
		return
	}
	if err := h.directory.DeleteGroup(r.Context(), id); err != nil {
		h.writeGroupFailure(w, err, "delete group")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* ── PATCH ─────────────────────────────────────────────────────────────── */

// PatchGroup answers `PATCH /Groups/{id}`.
//
// # The shapes this applies
//
//	{"op":"add",    "path":"members",                    "value":[{"value":"7"}]}
//	{"op":"replace","path":"members",                    "value":[{"value":"7"}]}
//	{"op":"remove", "path":"members",                    "value":[{"value":"7"}]}
//	{"op":"remove", "path":"members[value eq \"7\"]"}
//	{"op":"remove", "path":"members"}
//	{"op":"replace","path":"displayName",                "value":"Team"}
//	{"op":"replace",                                     "value":{"displayName":"Team"}}
//
// The bracketed form is the one Entra ID sends for every single-member removal,
// and a handler that did not read it would answer 200 to every "this person
// left the group" and apply none of them.
//
// # And what it refuses
//
// Any other path, by name, with 501. A PATCH is how an identity provider
// applies an incremental change, and it sends each one once.
func (h *Handler) PatchGroup(w http.ResponseWriter, r *http.Request) {
	if !h.ready(w) {
		return
	}
	id, ok := groupID(w, r)
	if !ok {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	var request patchRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalidSyntax", "the patch request could not be read")
		return
	}
	if len(request.Operations) == 0 {
		writeError(w, http.StatusBadRequest, "invalidValue", "the patch request carries no operations")
		return
	}

	operations, problem := readGroupPatch(request.Operations)
	if problem != "" {
		writeError(w, http.StatusNotImplemented, "invalidPath", problem)
		return
	}

	group, err := h.directory.GetGroup(r.Context(), id)
	if err != nil {
		h.writeGroupFailure(w, err, "read group")
		return
	}
	for _, operation := range operations {
		if operation.displayName != "" {
			if group, err = h.directory.RenameGroup(r.Context(), id, operation.displayName); err != nil {
				h.writeGroupFailure(w, err, "rename group")
				return
			}
			continue
		}

		members, ok := h.resolveMemberValues(w, r, operation.members)
		if !ok {
			return
		}
		switch operation.kind {
		case patchAddMembers:
			group, err = h.directory.AddGroupMembers(r.Context(), id, members)
		case patchReplaceMembers:
			group, err = h.directory.ReplaceGroupMembers(r.Context(), id, members)
		case patchRemoveMembers:
			group, err = h.directory.RemoveGroupMembers(r.Context(), id, members)
		case patchRemoveAllMembers:
			group, err = h.directory.ReplaceGroupMembers(r.Context(), id, nil)
		}
		if err != nil {
			h.writeGroupFailure(w, err, "patch group members")
			return
		}
	}
	writeJSON(w, http.StatusOK, groupResource(group))
}

// groupPatchKind names what one understood operation does.
type groupPatchKind int

const (
	patchRename groupPatchKind = iota
	patchAddMembers
	patchReplaceMembers
	patchRemoveMembers
	patchRemoveAllMembers
)

type groupPatch struct {
	kind        groupPatchKind
	members     []string
	displayName string
}

// readGroupPatch translates the operations, or names the first one it cannot.
//
// NOTHING is applied until every operation has been understood. A request whose
// second operation is unsupported must not leave the first one applied: the
// client is told the whole PATCH failed, and it will resend the whole PATCH.
func readGroupPatch(operations []patchOperation) ([]groupPatch, string) {
	parsed := make([]groupPatch, 0, len(operations))
	for _, operation := range operations {
		path := strings.TrimSpace(operation.Path)
		lowered := strings.ToLower(path)
		operationName := strings.ToLower(strings.TrimSpace(operation.Op))

		switch {
		case lowered == "displayname":
			var name string
			if err := json.Unmarshal(operation.Value, &name); err != nil || strings.TrimSpace(name) == "" {
				return nil, "the displayName attribute needs a non-empty string value"
			}
			parsed = append(parsed, groupPatch{kind: patchRename, displayName: strings.TrimSpace(name)})

		case lowered == "members":
			values, err := memberValues(operation.Value)
			if err != "" {
				return nil, err
			}
			switch operationName {
			case "add":
				parsed = append(parsed, groupPatch{kind: patchAddMembers, members: values})
			case "replace":
				parsed = append(parsed, groupPatch{kind: patchReplaceMembers, members: values})
			case "remove":
				if len(values) == 0 {
					parsed = append(parsed, groupPatch{kind: patchRemoveAllMembers})
					continue
				}
				parsed = append(parsed, groupPatch{kind: patchRemoveMembers, members: values})
			default:
				return nil, "this directory applies the add, replace and remove operations to members; " +
					strconv.Quote(operation.Op) + " is not one of them"
			}

		case strings.HasPrefix(lowered, "members["):
			value, ok := bracketedMemberValue(path)
			if !ok {
				return nil, "this directory reads one member filter shape, " +
					`members[value eq "<id>"]; it cannot read ` + strconv.Quote(path)
			}
			if operationName != "remove" {
				return nil, "a members[value eq …] path is applied only by a remove operation"
			}
			parsed = append(parsed, groupPatch{kind: patchRemoveMembers, members: []string{value}})

		case path == "":
			// A pathless operation carries an object of attributes. Only
			// displayName is read from it; a pathless members change is refused
			// rather than guessed at, because the operation carries no statement
			// about whether the list adds to or replaces the membership.
			var attributes struct {
				DisplayName string          `json:"displayName"`
				Members     json.RawMessage `json:"members"`
			}
			if err := json.Unmarshal(operation.Value, &attributes); err != nil {
				return nil, "the operation value could not be read"
			}
			if len(attributes.Members) > 0 {
				return nil, "a members change needs an explicit path: send " +
					`{"op":"add|replace|remove","path":"members",…}`
			}
			if strings.TrimSpace(attributes.DisplayName) == "" {
				// Nothing this service stores; the resource is unchanged and
				// the request is honest about having applied nothing.
				continue
			}
			parsed = append(parsed, groupPatch{
				kind:        patchRename,
				displayName: strings.TrimSpace(attributes.DisplayName),
			})

		default:
			return nil, "this directory can patch only the members and displayName attributes of a group; " +
				"it cannot patch " + strconv.Quote(path) + ". The project and the role a group grants are " +
				"authored on the binding, not pushed."
		}
	}
	return parsed, ""
}

// memberValues reads the `value` of every member in a patch operation value.
func memberValues(raw json.RawMessage) ([]string, string) {
	if len(raw) == 0 {
		return nil, ""
	}
	var members []struct {
		Value string `json:"value"`
	}
	if err := json.Unmarshal(raw, &members); err != nil {
		// A single member object, not an array, is also in the wild.
		var single struct {
			Value string `json:"value"`
		}
		if json.Unmarshal(raw, &single) != nil {
			return nil, "the members value must be a member object or an array of them"
		}
		members = append(members, single)
	}
	values := make([]string, 0, len(members))
	for _, member := range members {
		if strings.TrimSpace(member.Value) == "" {
			return nil, "every member needs a value naming the account"
		}
		values = append(values, strings.TrimSpace(member.Value))
	}
	return values, ""
}

// bracketedMemberValue reads `members[value eq "7"]`.
//
// It is a narrow, exact reader rather than a filter parser: the one shape
// identity providers send is understood, and everything else is refused with
// the path quoted. A general parser here would be a second, untested
// implementation of the expression language internal/scimdirectory/filter.go
// deliberately does not have.
func bracketedMemberValue(path string) (string, bool) {
	open := strings.Index(path, "[")
	if open < 0 || !strings.HasSuffix(path, "]") {
		return "", false
	}
	expression := strings.TrimSpace(path[open+1 : len(path)-1])
	parts := strings.SplitN(expression, " ", 3)
	if len(parts) != 3 || !strings.EqualFold(parts[0], "value") || !strings.EqualFold(parts[1], "eq") {
		return "", false
	}
	value := strings.TrimSpace(parts[2])
	if unquoted, err := strconv.Unquote(value); err == nil {
		value = unquoted
	}
	if value == "" {
		return "", false
	}
	return value, true
}

/* ── shared ────────────────────────────────────────────────────────────── */

func (h *Handler) resolveMembers(w http.ResponseWriter, r *http.Request, body groupBody) ([]int, bool) {
	values := make([]string, 0, len(body.Members))
	for _, member := range body.Members {
		if strings.TrimSpace(member.Value) == "" {
			writeError(w, http.StatusBadRequest, "invalidValue",
				"every member needs a value naming the account; a display name alone cannot be resolved")
			return nil, false
		}
		values = append(values, member.Value)
	}
	return h.resolveMemberValues(w, r, values)
}

// resolveMemberValues maps every member value onto an account id, and refuses
// the whole request if one of them cannot be resolved.
//
// It is all-or-nothing ON PURPOSE. Applying the members that resolved and
// dropping the rest would answer 200 for a group whose membership this service
// only partly holds, and the identity provider would never send the dropped
// ones again.
func (h *Handler) resolveMemberValues(w http.ResponseWriter, r *http.Request, values []string) ([]int, bool) {
	members := make([]int, 0, len(values))
	seen := make(map[int]struct{}, len(values))
	for _, value := range values {
		id, err := h.directory.ResolveMember(r.Context(), value)
		var (
			unknown   scimdirectory.UnknownMemberError
			ambiguous scimdirectory.AmbiguousMemberError
		)
		switch {
		case errors.As(err, &unknown):
			writeError(w, http.StatusBadRequest, "invalidValue",
				"no account carries the member value "+strconv.Quote(value)+
					". A member is matched by its platform id, its externalId or its address, "+
					"and the account must be provisioned through /Users first.")
			return nil, false
		case errors.As(err, &ambiguous):
			writeError(w, http.StatusBadRequest, "invalidValue",
				"the member value "+strconv.Quote(value)+" names more than one account, "+
					"so this push would have to choose one; send the platform id instead")
			return nil, false
		case err != nil:
			h.writeGroupFailure(w, err, "resolve group member")
			return nil, false
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		members = append(members, id)
	}
	return members, true
}

func groupID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "", "no such group")
		return 0, false
	}
	return id, true
}

func decodeGroup(w http.ResponseWriter, r *http.Request) (groupBody, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	var body groupBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalidSyntax", "the group resource could not be read")
		return groupBody{}, false
	}
	return body, true
}

// writeGroupFailure maps a store outcome to a SCIM response.
//
// A RoleMissingError is a 409 rather than a 500 because it is a real conflict
// between two authored things: the binding names a role, and the project no
// longer has it. The message names both, because fixing it means editing one of
// them and an operator cannot tell which from a generic failure.
func (h *Handler) writeGroupFailure(w http.ResponseWriter, err error, operation string) {
	var (
		roleMissing    scimdirectory.RoleMissingError
		unknownProject scimdirectory.UnknownProjectError
	)
	switch {
	case errors.Is(err, scimdirectory.ErrNotFound):
		writeError(w, http.StatusNotFound, "", "no such group")
	case errors.Is(err, scimdirectory.ErrNoBinding):
		writeError(w, http.StatusNotFound, "", "no such group")
	case errors.Is(err, scimdirectory.ErrConflict):
		writeError(w, http.StatusConflict, "uniqueness",
			"another group binding already uses that name or external identifier")
	case errors.As(err, &roleMissing):
		writeError(w, http.StatusConflict, "invalidValue",
			"the binding grants the role "+strconv.Quote(roleMissing.RoleName)+
				" on project "+strconv.Itoa(roleMissing.ProjectID)+
				", and that project has no such role; re-author the binding")
	case errors.As(err, &unknownProject):
		writeError(w, http.StatusConflict, "invalidValue",
			"the binding names project "+strconv.Itoa(unknownProject.ProjectID)+", which does not exist")
	default:
		slog.Error("SCIM: "+operation+" failed", "err", err)
		writeError(w, http.StatusInternalServerError, "", "the directory could not be reached")
	}
}
