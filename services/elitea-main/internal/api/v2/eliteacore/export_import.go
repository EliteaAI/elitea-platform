package eliteacore

import (
	"context"
	"encoding/json"
	"fmt"
	"math"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

// The reads and the encoders that the export and the import paths share.
//
// Both paths had one shape of defect, reported as issue #505 and named in pull
// request #499: a failure became a success, and the caller could not tell.
// The export answered 200 with a document that was missing whatever the failed
// read held. The import answered 201 with a row that was missing whatever the
// failed encode held. Neither said anything.
//
// The helpers here exist so that each failure has exactly one place to be
// reported from, and so that a reader can see the whole set at once.

// exportReadFailed is the message the export answers with when a read is lost.
//
// The export is a BACKUP. A document that is missing a version, a toolkit, a
// variable or a tag is worse than no document at all, because the operator
// keeps it, deletes the original and finds out later. So a lost read refuses
// the whole export rather than serving what it managed to collect. This is the
// rule #439 applied to `AvailableTools`: no rows gives a document with no rows,
// a lost read gives 500 and a named reason.
const exportReadFailed = "unable to read the application to export"

// exportedToolkits reads the toolkits that any version of one application uses.
//
// It returns the export entries and the tool_id-to-import_uuid map that the
// version entries reference. All three faults #439 names are reported: the
// query, each row's scan, and the fault that `rows.Next` reports at the end
// through `rows.Err` — a connection lost half way through a result set stops
// the loop and looks exactly like the end of the rows.
func (h *Handler) exportedToolkits(ctx context.Context, schema, applicationID string) ([]map[string]any, map[int]string, error) {
	rows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT DISTINCT t.id, t.name, t.type, COALESCE(t.settings::text, '{}')
		FROM %q.entity_tool_mapping etm
		JOIN %q.elitea_tools t ON t.id = etm.tool_id
		JOIN %q.application_versions av ON av.id = etm.entity_version_id
		WHERE av.application_id = $1`, schema, schema, schema), applicationID)
	if err != nil {
		return nil, nil, fmt.Errorf("query the toolkits of application %q in %q: %w", applicationID, schema, err)
	}
	defer rows.Close()

	toolkitMap := map[int]string{}
	toolkits := make([]map[string]any, 0)
	for rows.Next() {
		var toolID int
		var name, toolType, settingsText string
		if err := rows.Scan(&toolID, &name, &toolType, &settingsText); err != nil {
			return nil, nil, fmt.Errorf("scan a toolkit of application %q in %q: %w", applicationID, schema, err)
		}
		var stored map[string]any
		if err := json.Unmarshal([]byte(settingsText), &stored); err != nil {
			return nil, nil, fmt.Errorf("decode the settings of toolkit %d in %q: %w", toolID, schema, err)
		}
		if stored == nil {
			stored = map[string]any{}
		}
		// Strip sensitive settings for export.
		settings := map[string]any{}
		for key, value := range stored {
			settings[key] = value
		}
		for _, secret := range []string{"api_key", "access_token", "token", "api_key_type",
			"client_secret", "gitlab_personal_access_token", "private_token",
			"sonar_token", "qtest_api_token", "client_id",
			"password", "secret", "app_id"} {
			delete(settings, secret)
		}
		importUUID := fmt.Sprintf("tool-%d", toolID)
		toolkitMap[toolID] = importUUID
		toolkits = append(toolkits, map[string]any{
			"id": toolID, "name": name, "type": toolType,
			"import_uuid": importUUID, "settings": settings,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("read the toolkits of application %q in %q: %w", applicationID, schema, err)
	}
	return toolkits, toolkitMap, nil
}

// exportedVersionRow is one row of the version query, held until the result set
// is closed.
//
// The rows are collected before the per-version reads run. The previous code
// ran four more queries against the same pool while this result set was still
// open, which needs a second connection for every version and deadlocks a pool
// of one. Collecting first costs one slice and removes that dependency.
type exportedVersionRow struct {
	id            int
	applicationID int
	authorID      int
	name          string
	status        string
	agentType     string
	instructions  string
	welcomeMsg    string
	llmText       string
	startersText  string
	metaText      string
	uuid          string
}

// exportedVersions reads every version of one application, with its tools,
// variables and tags.
func (h *Handler) exportedVersions(
	ctx context.Context, schema, applicationID string, toolkitMap map[int]string,
) ([]map[string]any, error) {
	collected, err := h.exportedVersionRows(ctx, schema, applicationID)
	if err != nil {
		return nil, err
	}

	versions := make([]map[string]any, 0, len(collected))
	for _, row := range collected {
		var llm, starters, meta any
		if err := json.Unmarshal([]byte(row.llmText), &llm); err != nil {
			return nil, fmt.Errorf("decode llm_settings of version %d in %q: %w", row.id, schema, err)
		}
		if err := json.Unmarshal([]byte(row.startersText), &starters); err != nil {
			return nil, fmt.Errorf("decode conversation_starters of version %d in %q: %w", row.id, schema, err)
		}
		if err := json.Unmarshal([]byte(row.metaText), &meta); err != nil {
			return nil, fmt.Errorf("decode meta of version %d in %q: %w", row.id, schema, err)
		}

		// Ensure meta has icon_meta.
		metaMap, isMetaMap := meta.(map[string]any)
		if isMetaMap {
			if _, hasIcon := metaMap["icon_meta"]; !hasIcon {
				metaMap["icon_meta"] = map[string]any{}
			}
		} else {
			metaMap = map[string]any{"icon_meta": map[string]any{}}
			meta = metaMap
		}

		// Ensure llm_settings.model_project_id is a string.
		if llmMap, ok := llm.(map[string]any); ok {
			if projectID, exists := llmMap["model_project_id"]; exists {
				if numeric, ok := projectID.(float64); ok {
					llmMap["model_project_id"] = fmt.Sprintf("%d", int(numeric))
				}
			}
		}

		tools, err := h.exportedVersionTools(ctx, schema, row.id, toolkitMap)
		if err != nil {
			return nil, err
		}
		variables, err := h.exportedVersionVariables(ctx, schema, row.id)
		if err != nil {
			return nil, err
		}
		tags, err := h.exportedVersionTags(ctx, schema, row.id)
		if err != nil {
			return nil, err
		}

		_, isForked := metaMap["parent_entity_id"]

		entry := map[string]any{
			"id": fmt.Sprintf("%d", row.id), "name": row.name, "status": row.status,
			"application_id": fmt.Sprintf("%d", row.applicationID),
			"author_id":      fmt.Sprintf("%d", row.authorID),
			"agent_type":     row.agentType, "instructions": row.instructions,
			"welcome_message": row.welcomeMsg, "llm_settings": llm,
			"conversation_starters": starters, "meta": meta,
			"tools": tools, "variables": variables, "tags": tags,
			"is_forked": isForked,
		}
		if row.uuid != "" {
			entry["import_version_uuid"] = row.uuid
		}
		versions = append(versions, entry)
	}
	return versions, nil
}

func (h *Handler) exportedVersionRows(ctx context.Context, schema, applicationID string) ([]exportedVersionRow, error) {
	rows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, name, status, COALESCE(agent_type, 'openai'),
			COALESCE(instructions, ''), COALESCE(welcome_message, ''),
			COALESCE(llm_settings::text, '{}'), COALESCE(conversation_starters::text, '[]'),
			COALESCE(meta::text, '{}'), COALESCE(uuid::text, ''), application_id, COALESCE(author_id, 0)
		FROM %q.application_versions WHERE application_id = $1
		ORDER BY created_at`, schema), applicationID)
	if err != nil {
		return nil, fmt.Errorf("query the versions of application %q in %q: %w", applicationID, schema, err)
	}
	defer rows.Close()

	collected := make([]exportedVersionRow, 0)
	for rows.Next() {
		var row exportedVersionRow
		if err := rows.Scan(&row.id, &row.name, &row.status, &row.agentType,
			&row.instructions, &row.welcomeMsg, &row.llmText, &row.startersText,
			&row.metaText, &row.uuid, &row.applicationID, &row.authorID); err != nil {
			return nil, fmt.Errorf("scan a version of application %q in %q: %w", applicationID, schema, err)
		}
		collected = append(collected, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read the versions of application %q in %q: %w", applicationID, schema, err)
	}
	return collected, nil
}

// exportedVersionTools reads one version's toolkit references.
//
// `COALESCE(selected_tools::text, '[]')` and not `'{}'`: the column's own
// default is `'[]'::jsonb` (internal/infra/db/migrations/001_initial.sql), the
// route that writes a selection writes a JSON array of tool names
// (internal/api/v2/toolkits/handler.go, selectedToolsPayload), and the chat
// read only understands an array (internal/db/queries/agent_chat.sql). A NULL
// column that exported as `{}` put a value in the file that no reader of the
// file can use.
func (h *Handler) exportedVersionTools(
	ctx context.Context, schema string, versionID int, toolkitMap map[int]string,
) ([]map[string]any, error) {
	rows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT tool_id, COALESCE(selected_tools::text, '[]')
		FROM %q.entity_tool_mapping WHERE entity_version_id = $1`, schema), versionID)
	if err != nil {
		return nil, fmt.Errorf("query the toolkit references of version %d in %q: %w", versionID, schema, err)
	}
	defer rows.Close()

	tools := make([]map[string]any, 0)
	for rows.Next() {
		var toolID int
		var selectedText string
		if err := rows.Scan(&toolID, &selectedText); err != nil {
			return nil, fmt.Errorf("scan a toolkit reference of version %d in %q: %w", versionID, schema, err)
		}
		var selected any
		if err := json.Unmarshal([]byte(selectedText), &selected); err != nil {
			return nil, fmt.Errorf("decode selected_tools of version %d in %q: %w", versionID, schema, err)
		}
		tools = append(tools, map[string]any{
			"import_uuid":    toolkitMap[toolID],
			"selected_tools": selected,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read the toolkit references of version %d in %q: %w", versionID, schema, err)
	}
	return tools, nil
}

func (h *Handler) exportedVersionVariables(ctx context.Context, schema string, versionID int) ([]map[string]any, error) {
	rows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT name, COALESCE(value, '') FROM %q.application_variables
		WHERE application_version_id = $1 ORDER BY id`, schema), versionID)
	if err != nil {
		return nil, fmt.Errorf("query the variables of version %d in %q: %w", versionID, schema, err)
	}
	defer rows.Close()

	variables := make([]map[string]any, 0)
	for rows.Next() {
		var name, value string
		if err := rows.Scan(&name, &value); err != nil {
			return nil, fmt.Errorf("scan a variable of version %d in %q: %w", versionID, schema, err)
		}
		variables = append(variables, map[string]any{"name": name, "value": value})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read the variables of version %d in %q: %w", versionID, schema, err)
	}
	return variables, nil
}

func (h *Handler) exportedVersionTags(ctx context.Context, schema string, versionID int) ([]map[string]any, error) {
	rows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT t.name, COALESCE(t.data::text, '{}')
		FROM %q.application_version_tag_association vta
		JOIN %q.tags t ON t.id = vta.tag_id
		WHERE vta.version_id = $1`, schema, schema), versionID)
	if err != nil {
		return nil, fmt.Errorf("query the tags of version %d in %q: %w", versionID, schema, err)
	}
	defer rows.Close()

	tags := make([]map[string]any, 0)
	for rows.Next() {
		var name, dataText string
		if err := rows.Scan(&name, &dataText); err != nil {
			return nil, fmt.Errorf("scan a tag of version %d in %q: %w", versionID, schema, err)
		}
		var data any
		if err := json.Unmarshal([]byte(dataText), &data); err != nil {
			return nil, fmt.Errorf("decode the data of a tag of version %d in %q: %w", versionID, schema, err)
		}
		if data == nil {
			data = map[string]any{}
		}
		tags = append(tags, map[string]any{"name": name, "data": data})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read the tags of version %d in %q: %w", versionID, schema, err)
	}
	return tags, nil
}

// ── the import side ─────────────────────────────────────────────────────────

// importWriteFailed is the message the import and the fork answer with when
// they cannot reach a database at all.
const importWriteFailed = "the import cannot run without a database connection"

// importPrincipalUserID resolves the user that the import and the fork write
// into applications.owner_id, application_versions.author_id and
// elitea_tools.author_id.
//
// Both paths read the principal like this:
//
//	userID := 1
//	if user.ID != "" {
//		_, _ = fmt.Sscanf(user.ID, "%d", &userID)
//	}
//
// An identifier the scan could not read left the 1 in place, so every row the
// request wrote was given to user 1 — a real account on every deployment, and
// the first account on most of them. The rows then appear in that person's
// name, the agent list filters on the same column, and nothing recorded that a
// substitution had happened.
//
// `OwningUserID` is the rule the sibling create route already applies
// (internal/api/v2/applications/handler.go, `principal`). It accepts a session
// principal and a fully validated token principal, whose owner it returns, and
// refuses a token principal that carries no owner. An import writes rows that
// carry an author, so it needs the same principal a create needs.
func importPrincipalUserID(ctx context.Context) (int, bool) {
	user, ok := auth.UserFromContext(ctx)
	if !ok {
		return 0, false
	}
	ownerID, ok := user.OwningUserID()
	// The author and owner columns are INTEGER, so an id above math.MaxInt32
	// names no row this schema holds. On a 32-bit build, `int(ownerID)`
	// truncates such an id into one that belongs to a different account. That
	// is the same mis-attribution this function exists to stop. An id outside
	// the range is refused, not truncated.
	if !ok || ownerID <= 0 || ownerID > math.MaxInt32 {
		return 0, false
	}
	return int(ownerID), true
}

// The three functions below encode one request-body key for one jsonb column.
//
// Five `if b, e := json.Marshal(x); e == nil` blocks wrote an empty value for
// `llm_settings`, `conversation_starters`, `meta`, a toolkit's `settings` and
// `selected_tools` when the encode failed, and the import still answered 201.
// The encode is only half of it: each block starts with a type assertion, and a
// value of the wrong JSON type took the same silent empty default. That is the
// `selected_tools` data loss — see importedJSONValue.
//
// Each function keeps ABSENT apart from WRONG. An absent key, and a JSON null,
// mean "this file says nothing about this column", so the column keeps its
// default. A key that is present with the wrong shape, or that cannot be
// encoded, is a fault and is reported.

// importedJSONObject encodes one key that a jsonb column holds as a JSON
// object: `llm_settings`, `meta`, and a toolkit's `settings`.
func importedJSONObject(source map[string]any, key string) (string, error) {
	raw, present := source[key]
	if !present || raw == nil {
		return "{}", nil
	}
	value, ok := raw.(map[string]any)
	if !ok {
		return "", fmt.Errorf("%s must be a JSON object", key)
	}
	return importedJSONEncode(key, value)
}

// importedJSONArray encodes one key that a jsonb column holds as a JSON array:
// `conversation_starters`.
func importedJSONArray(source map[string]any, key string) (string, error) {
	raw, present := source[key]
	if !present || raw == nil {
		return "[]", nil
	}
	value, ok := raw.([]any)
	if !ok {
		return "", fmt.Errorf("%s must be a JSON array", key)
	}
	return importedJSONEncode(key, value)
}

// importedJSONValue keeps whatever JSON the file carries, whatever its type.
//
// This is `selected_tools`, and it is the fault the issue asks to repair first.
// The import read the key as `map[string]any`. The column's default is a JSON
// ARRAY, the route that writes a selection writes an array of tool names
// (internal/api/v2/toolkits/handler.go, selectedToolsPayload), and the export
// writes the column out as the database holds it. So the assertion failed on
// every selection a user had actually made, the import stored `{}` in its
// place, and an export followed by an import lost the tool selection with no
// message anywhere.
//
// The repair keeps the value verbatim rather than requiring an array. The
// import's job is to reproduce the document it was given: a file written by an
// older installation may carry a different shape, and refusing it would trade
// one kind of loss for another. `empty` is what an absent key means, and for
// this column it is `[]`, which is the column's own default.
func importedJSONValue(source map[string]any, key, empty string) (string, error) {
	raw, present := source[key]
	if !present || raw == nil {
		return empty, nil
	}
	return importedJSONEncode(key, raw)
}

// importedJSONEncode is the one place the encode failure is reported from.
//
// A value that `encoding/json` decoded can always be encoded again, so no
// request body can reach this error. It is returned rather than swallowed
// because the callers cannot know that, and because the four fallbacks it
// replaces are how the type faults above stayed invisible: an `e == nil` guard
// reads as care and behaves as silence.
func importedJSONEncode(key string, value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("unable to encode %s: %w", key, err)
	}
	return string(encoded), nil
}
