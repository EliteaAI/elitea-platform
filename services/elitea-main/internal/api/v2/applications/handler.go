package applications

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/secrets"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type Handler struct {
	repo applications.Repository
	pool *pgxpool.Pool
}

func NewHandler(repo applications.Repository, pool ...*pgxpool.Pool) *Handler {
	h := &Handler{repo: repo}
	if len(pool) > 0 {
		h.pool = pool[0]
	}
	return h
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{applicationID}", h.Get)
	r.Put("/{applicationID}", h.Update)
	r.Delete("/{applicationID}", h.Delete)
	r.Get("/{applicationID}/versions", h.ListVersions)
	r.Get("/{applicationID}/versions/{versionID}", h.GetVersion)
	return r
}

func (h *Handler) GetDefaultVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	versions, err := h.repo.ListVersions(r.Context(), projectID, applicationID)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	// Same resolution order as the UI's own selectDefaultVersion
	// (apps/elitea-web/src/entities/version/model/selectors.ts): the version
	// recorded in the application's meta.default_version_id, else the
	// well-known unnamed-default version "base", else the newest.
	for _, v := range versions {
		if v.IsDefault {
			writeJSON(w, http.StatusOK, v)
			return
		}
	}
	for _, v := range versions {
		if v.Name == defaultVersionName {
			writeJSON(w, http.StatusOK, v)
			return
		}
	}

	if len(versions) > 0 {
		writeJSON(w, http.StatusOK, versions[0])
		return
	}

	apierr.Write(w, apierr.NotFound("no versions found"))
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	// UI sends limit/offset; convert to page/pageSize
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit < 1 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	page := (offset / limit) + 1

	// UI sends "query" for search text
	search := r.URL.Query().Get("query")
	if search == "" {
		search = r.URL.Query().Get("search")
	}

	req := applications.ListRequest{
		ProjectID:  projectID,
		Page:       page,
		PageSize:   limit,
		Search:     search,
		Tags:       r.URL.Query().Get("tags"),
		FolderID:   r.URL.Query().Get("folder_id"),
		AgentsType: r.URL.Query().Get("agents_type"),
	}

	resp, err := h.repo.List(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	app, err := h.repo.Get(r.Context(), projectID, applicationID)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	versions := h.getVersions(r.Context(), projectID, applicationID)
	result := map[string]any{
		"id":          app.ID,
		"name":        app.Name,
		"description": app.Description,
		"icon":        app.Icon,
		"owner_id":    app.CreatedBy,
		"created_at":  app.CreatedAt,
		"versions":    versions,
	}

	// Include version_details for the first (latest) version — matches pylon response contract.
	if len(versions) > 0 {
		firstVersionID := versions[0]["id"].(string)
		if vd := h.fetchVersionDetails(r.Context(), projectID, applicationID, firstVersionID); vd != nil {
			result["version_details"] = vd
		}
	}

	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) getVersions(ctx context.Context, projectID, applicationID string) []map[string]any {
	s, ok := tenantSchema(projectID)
	if !ok {
		return []map[string]any{}
	}
	q := fmt.Sprintf(`SELECT id, name, status, agent_type, created_at FROM %s.application_versions WHERE application_id = $1 ORDER BY id`, s)
	rows, err := h.pool.Query(ctx, q, applicationID)
	if err != nil {
		return []map[string]any{}
	}
	defer rows.Close()

	var versions []map[string]any
	for rows.Next() {
		var id int
		var name, status, agentType string
		var createdAt any
		if err := rows.Scan(&id, &name, &status, &agentType, &createdAt); err != nil {
			continue
		}
		versions = append(versions, map[string]any{
			"id":         strconv.Itoa(id),
			"name":       name,
			"status":     status,
			"agent_type": agentType,
			"created_at": createdAt,
		})
	}
	if versions == nil {
		versions = []map[string]any{}
	}
	return versions
}

// fetchVersionDetails returns full version details for a single version, or nil on error.
func (h *Handler) fetchVersionDetails(ctx context.Context, projectID, applicationID, versionID string) map[string]any {
	if h.pool == nil {
		version, err := h.repo.GetVersion(ctx, projectID, applicationID, versionID)
		if err != nil {
			return nil
		}
		b, _ := json.Marshal(version)
		var m map[string]any
		// b is from json.Marshal above — cannot fail
		_ = json.Unmarshal(b, &m)
		return m
	}

	s, ok := tenantSchema(projectID)
	if !ok {
		return nil
	}

	var id int
	var appID int
	var name, status, agentType string
	var instructions, welcomeMsg *string
	var llmSettingsJSON, metaJSON, startersJSON, pipelineSettingsJSON []byte
	var createdAt interface{}
	var authorID *int

	err := h.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT v.id, v.application_id, v.name, v.status, v.created_at,
			v.agent_type, v.instructions, v.welcome_message,
			COALESCE(v.llm_settings::text, '{}'), COALESCE(v.meta::text, '{}'),
			COALESCE(v.conversation_starters::text, '[]'),
			COALESCE(v.pipeline_settings::text, '{}'),
			v.author_id
		FROM %s.application_versions v
		WHERE v.application_id = $1 AND v.id = $2`, s), applicationID, versionID).Scan(
		&id, &appID, &name, &status, &createdAt,
		&agentType, &instructions, &welcomeMsg,
		&llmSettingsJSON, &metaJSON, &startersJSON, &pipelineSettingsJSON,
		&authorID,
	)
	if err != nil {
		return nil
	}

	var llmSettings, meta, starters, pipelineSettings any
	// JSON was read from DB via COALESCE — cannot produce invalid JSON
	_ = json.Unmarshal(llmSettingsJSON, &llmSettings)
	_ = json.Unmarshal(metaJSON, &meta)
	_ = json.Unmarshal(startersJSON, &starters)
	_ = json.Unmarshal(pipelineSettingsJSON, &pipelineSettings)

	instrVal := ""
	if instructions != nil {
		instrVal = *instructions
	}
	welcomeVal := ""
	if welcomeMsg != nil {
		welcomeVal = *welcomeMsg
	}

	tools := make([]map[string]any, 0)
	toolRows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT etm.id, etm.tool_id, etm.entity_type, COALESCE(etm.selected_tools::text, '{}'),
			t.name, t.type, t.settings
		FROM %s.entity_tool_mapping etm
		LEFT JOIN %s.elitea_tools t ON t.id = etm.tool_id
		WHERE etm.entity_version_id = $1`, s, s), versionID)
	if err == nil {
		defer toolRows.Close()
		for toolRows.Next() {
			var etmID, toolID int
			var entityType, selectedToolsStr string
			var tName, tType *string
			var tConfig []byte
			if err := toolRows.Scan(&etmID, &toolID, &entityType, &selectedToolsStr, &tName, &tType, &tConfig); err != nil {
				continue
			}
			var selectedTools any
			// selectedToolsStr is COALESCE'd DB JSON — cannot fail
			_ = json.Unmarshal([]byte(selectedToolsStr), &selectedTools)
			var config any
			if tConfig != nil {
				// tConfig is DB-stored JSON — cannot fail
				_ = json.Unmarshal(tConfig, &config)
			}
			tool := map[string]any{
				"id":             etmID,
				"tool_id":        toolID,
				"entity_type":    entityType,
				"selected_tools": selectedTools,
			}
			if tName != nil {
				tool["name"] = *tName
			}
			if tType != nil {
				tool["type"] = *tType
			}
			if config != nil {
				tool["config"] = config
			}
			tools = append(tools, tool)
		}
	}

	authorIDStr := ""
	if authorID != nil {
		authorIDStr = strconv.Itoa(*authorID)
	}

	appToolRows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, name, type, settings::text
		FROM %s.application_tools
		WHERE application_version_id = $1`, s), versionID)
	if err == nil {
		defer appToolRows.Close()
		for appToolRows.Next() {
			var atID int
			var atName, atType, settingsStr string
			if err := appToolRows.Scan(&atID, &atName, &atType, &settingsStr); err != nil {
				continue
			}
			var settings any
			// settingsStr is DB-stored JSON — cannot fail
			_ = json.Unmarshal([]byte(settingsStr), &settings)
			tools = append(tools, map[string]any{
				"id":        atID,
				"name":      atName,
				"type":      atType,
				"settings":  settings,
				"author_id": authorIDStr,
			})
		}
	}

	variables := make([]map[string]any, 0)
	varRows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT name, COALESCE(value, '')
		FROM %s.application_variables
		WHERE application_version_id = $1
		ORDER BY id`, s), versionID)
	if err == nil {
		defer varRows.Close()
		for varRows.Next() {
			var vName, vValue string
			if err := varRows.Scan(&vName, &vValue); err != nil {
				continue
			}
			variables = append(variables, map[string]any{
				"name":  vName,
				"value": vValue,
			})
		}
	}

	return map[string]any{
		"id":                    strconv.Itoa(id),
		"application_id":        strconv.Itoa(appID),
		"name":                  name,
		"status":                status,
		"created_at":            createdAt,
		"agent_type":            agentType,
		"instructions":          instrVal,
		"welcome_message":       welcomeVal,
		"llm_settings":          llmSettings,
		"meta":                  meta,
		"conversation_starters": starters,
		"pipeline_settings":     pipelineSettings,
		"author_id":             authorIDStr,
		"tools":                 tools,
		"tags":                  []any{},
		"variables":             variables,
	}
}

// principal resolves the owning auth_core__user id of the authenticated
// caller. Every route reaching this handler is inside the authenticated group
// (internal/api/router.go), so a missing principal is a composition error, not
// an anonymous caller — it is refused rather than defaulted to user 1, which
// is what made every application in the prototype owned by user 1 regardless
// of who created it. Token principals resolve to their owning user;
// auth.User.OwningUserID never accepts a token id as an author.
func principal(r *http.Request) (auth.User, int64, bool) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		return auth.User{}, 0, false
	}
	ownerID, ok := user.OwningUserID()
	if !ok {
		return auth.User{}, 0, false
	}
	return user, ownerID, true
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	if _, ok := tenantSchema(projectID); !ok {
		apierr.Write(w, apierr.BadRequest("invalid project id"))
		return
	}
	user, ownerID, ok := principal(r)
	if !ok {
		apierr.Write(w, apierr.Unauthorized("an authenticated principal is required"))
		return
	}
	userID := strconv.FormatInt(ownerID, 10)

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	req := applications.CreateRequest{
		ProjectID:   projectID,
		Name:        strVal(body, "name"),
		Description: strVal(body, "description"),
		Type:        strVal(body, "type"),
		Icon:        strVal(body, "icon"),
		OwnerID:     ownerID,
	}

	// Pylon creates the first version alongside the application, and so does
	// the repository — in one transaction. An application with no version row
	// is invisible to List (which INNER JOINs application_versions) and cannot
	// be opened in the agent editor, so a half-created agent must not commit.
	if versions, ok := body["versions"].([]any); ok && len(versions) > 0 {
		if vBody, ok := versions[0].(map[string]any); ok {
			// Validate model_project_id if llm_settings provided
			if llm, ok := vBody["llm_settings"].(map[string]any); ok {
				if mpid, ok := llm["model_project_id"].(string); ok && mpid != "" && mpid != projectID {
					// Non-numeric project IDs are treated as invalid UUIDs
					if _, err := strconv.Atoi(mpid); err != nil {
						apierr.Write(w, apierr.BadRequest("invalid model_project_id: project not found"))
						return
					}
				}
			}
			req.InitialVersion = versionFromBody(vBody, ownerID)
		}
	}

	app, err := h.repo.Create(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	resp := map[string]any{
		"id":          app.ID,
		"name":        app.Name,
		"description": app.Description,
		"type":        app.Type,
		"icon":        app.Icon,
		"owner_id":    userID,
		"created_at":  app.CreatedAt,
	}
	if len(app.Versions) > 0 {
		versionDetails := versionDetailsResponse(app.Versions[0], user, userID)
		resp["version_details"] = versionDetails
		resp["versions"] = []any{versionDetails}
	}
	writeJSON(w, http.StatusCreated, resp)
}

// versionFromBody maps a pylon-shaped version write body onto the columns
// application_versions actually has. `variables` has no column of its own on
// the version row — pylon carries it inside meta alongside step_limit — so it
// is folded into meta here, matching what the prototype's raw SQL did.
func versionFromBody(vBody map[string]any, authorID int64) *applications.Version {
	name, _ := vBody["name"].(string)
	agentType, _ := vBody["agent_type"].(string)
	instructions, _ := vBody["instructions"].(string)
	welcomeMessage, _ := vBody["welcome_message"].(string)
	llmSettings, _ := vBody["llm_settings"].(map[string]any)
	starters, _ := vBody["conversation_starters"].([]any)

	meta, _ := vBody["meta"].(map[string]any)
	if meta == nil {
		meta = map[string]any{}
	}
	if _, ok := meta["step_limit"]; !ok {
		meta["step_limit"] = defaultStepLimit
	}
	if vars, ok := vBody["variables"].([]any); ok && len(vars) > 0 {
		meta["variables"] = vars
	}

	return &applications.Version{
		Name:                 name,
		AuthorID:             authorID,
		AgentType:            agentType,
		Instructions:         instructions,
		WelcomeMessage:       welcomeMessage,
		LLMSettings:          llmSettings,
		ConversationStarters: starters,
		Meta:                 meta,
	}
}

const defaultStepLimit = 25

func versionDetailsResponse(ver applications.Version, user auth.User, userID string) map[string]any {
	llm := ver.LLMSettings
	if llm == nil {
		llm = map[string]any{}
	}
	starters := ver.ConversationStarters
	if starters == nil {
		starters = []any{}
	}
	variables, _ := ver.Meta["variables"].([]any)
	if variables == nil {
		variables = []any{}
	}
	return map[string]any{
		"id":                    ver.ID,
		"application_id":        ver.ApplicationID,
		"name":                  ver.Name,
		"status":                ver.Status,
		"author_id":             userID,
		"created_at":            ver.CreatedAt,
		"author":                map[string]any{"id": userID, "email": user.Email, "name": user.Name},
		"meta":                  ver.Meta,
		"is_forked":             false,
		"is_default":            ver.IsDefault,
		"agent_type":            ver.AgentType,
		"instructions":          ver.Instructions,
		"welcome_message":       ver.WelcomeMessage,
		"llm_settings":          llm,
		"conversation_starters": starters,
		"tools":                 []any{},
		"variables":             variables,
		"tags":                  []any{},
	}
}

func strVal(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")
	user, ownerID, ok := principal(r)
	if !ok {
		apierr.Write(w, apierr.Unauthorized("an authenticated principal is required"))
		return
	}
	userID := strconv.FormatInt(ownerID, 10)

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	// Handle version update if present
	var versionData map[string]any
	if v, ok := body["version"].(map[string]any); ok {
		versionData = v
	}

	// Validate version IDs if provided
	if versionData != nil {
		vAppID := anyStr(versionData, "application_id")
		versionID := anyStr(versionData, "id")

		// application_id is required and must match
		if _, hasAppID := versionData["application_id"]; !hasAppID {
			apierr.Write(w, apierr.BadRequest("application_id is required in version"))
			return
		}
		if vAppID != applicationID {
			apierr.Write(w, apierr.BadRequest("application_id mismatch in version"))
			return
		}

		// version id is required
		if _, hasID := versionData["id"]; !hasID {
			apierr.Write(w, apierr.BadRequest("version id is required"))
			return
		}

		// Validate version_id exists for this application
		versions, _ := h.repo.ListVersions(r.Context(), projectID, applicationID)
		found := false
		for _, ver := range versions {
			if ver.ID == versionID {
				found = true
				break
			}
		}
		if !found {
			apierr.Write(w, apierr.BadRequest("version id mismatch: not found for this application"))
			return
		}

		// Reject renaming protected versions (base, latest)
		if vName := anyStr(versionData, "name"); vName != "" {
			for _, ver := range versions {
				if ver.ID == versionID {
					if (ver.Name == "latest" || ver.Name == "base") && vName != ver.Name {
						apierr.Write(w, apierr.BadRequest("cannot rename base/latest version"))
						return
					}
				}
			}
		}
	}

	// Update application fields
	var req applications.UpdateRequest
	req.ProjectID = projectID
	req.ApplicationID = applicationID
	if n, ok := body["name"].(string); ok {
		req.Name = &n
	}
	if d, ok := body["description"].(string); ok {
		req.Description = &d
	}
	if ic, ok := body["icon"].(string); ok {
		req.Icon = &ic
	}

	app, err := h.repo.Update(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	resp := map[string]any{
		"id":          app.ID,
		"name":        app.Name,
		"description": app.Description,
		"icon":        app.Icon,
		// The application's owner is the row's owner_id, not whoever is
		// editing it now — an update does not transfer ownership.
		"owner_id":   app.OwnerID,
		"created_at": app.CreatedAt,
	}

	// Update version if provided
	if versionData != nil {
		versionID := anyStr(versionData, "id")
		if versionID != "" {
			v := applications.Version{
				Name: anyStr(versionData, "name"),
			}
			if instr, ok := versionData["instructions"].(string); ok {
				v.Instructions = instr
			}
			ver, vErr := h.repo.UpdateVersion(r.Context(), projectID, applicationID, versionID, v)
			if vErr == nil {
				resp["version_details"] = versionDetailsResponse(ver, user, userID)
			}
		}
	}

	writeJSON(w, http.StatusCreated, resp)
}

func anyStr(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	if v, ok := m[key].(float64); ok {
		return strconv.FormatInt(int64(v), 10)
	}
	return ""
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	s, ok := tenantSchema(projectID)
	if !ok {
		apierr.Write(w, apierr.BadRequest("invalid project id"))
		return
	}

	// Guard: block deletion if any version is published/embedded
	if h.pool != nil {
		var pubCount int
		if err := h.pool.QueryRow(r.Context(), fmt.Sprintf(
			`SELECT COUNT(*) FROM %s.application_versions WHERE application_id = $1 AND status IN ('published','embedded')`, s),
			applicationID).Scan(&pubCount); err != nil {
			apierr.Write(w, apierr.Internal("failed to check published versions"))
			return
		}
		if pubCount > 0 {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": "Unpublish first. Cannot delete application with published versions.",
			})
			return
		}
	}

	if err := h.repo.Delete(r.Context(), projectID, applicationID); err != nil {
		// Idempotent delete: return 204 even if not found
		if strings.Contains(err.Error(), "not found") {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		apierr.Write(w, err)
		return
	}

	// Clean up application_tools entries on other versions that reference this deleted app
	if h.pool != nil {
		// best-effort cleanup; ignore error so the 204 response is still sent
		_, _ = h.pool.Exec(r.Context(), fmt.Sprintf(`
			DELETE FROM %s.application_tools
			WHERE type = 'application'
			AND settings->>'application_id' = $1`, s), applicationID)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ListVersions(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	versions, err := h.repo.ListVersions(r.Context(), projectID, applicationID)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": versions})
}

func (h *Handler) GetVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")
	versionID := chi.URLParam(r, "versionID")

	resp := h.fetchVersionDetails(r.Context(), projectID, applicationID, versionID)
	if resp == nil {
		apierr.Write(w, apierr.NotFound("version not found"))
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	name, _ := body["name"].(string)
	if name == "" {
		apierr.Write(w, apierr.BadRequest("version name is required"))
		return
	}

	user, ownerID, ok := principal(r)
	if !ok {
		apierr.Write(w, apierr.Unauthorized("an authenticated principal is required"))
		return
	}
	userID := strconv.FormatInt(ownerID, 10)

	ver, err := h.repo.CreateVersion(r.Context(), projectID, applicationID, *versionFromBody(body, ownerID))
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, versionDetailsResponse(ver, user, userID))
}

func (h *Handler) UpdateVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")
	versionID := chi.URLParam(r, "versionID")

	if _, ok := tenantSchema(projectID); !ok {
		apierr.Write(w, apierr.BadRequest("invalid project id"))
		return
	}

	// Guard: block update of published/embedded versions
	if h.pool != nil {
		s, _ := tenantSchema(projectID)
		var status string
		err := h.pool.QueryRow(r.Context(), fmt.Sprintf(
			`SELECT status FROM %s.application_versions WHERE application_id = $1 AND id = $2`, s),
			applicationID, versionID).Scan(&status)
		if err == nil && (status == "published" || status == "embedded") {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": "Published version can not be updated. Unpublish first.",
			})
			return
		}
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	user, ownerID, ok := principal(r)
	if !ok {
		apierr.Write(w, apierr.Unauthorized("an authenticated principal is required"))
		return
	}

	// Only the keys the caller actually sent are written: the repository
	// leaves an unset field alone rather than blanking it. The previous
	// implementation opened its SET list with `updated_at = now()` —
	// application_versions has no updated_at column (migrations/001_initial
	// .sql), so every version update failed with 42P01 and returned a 500.
	v := applications.Version{}
	if name, ok := body["name"].(string); ok {
		v.Name = name
	}
	if instructions, ok := body["instructions"].(string); ok {
		v.Instructions = instructions
	}
	if welcomeMessage, ok := body["welcome_message"].(string); ok {
		v.WelcomeMessage = welcomeMessage
	}
	if agentType, ok := body["agent_type"].(string); ok {
		v.AgentType = agentType
	}
	if llm, ok := body["llm_settings"].(map[string]any); ok {
		v.LLMSettings = llm
	}
	if starters, ok := body["conversation_starters"].([]any); ok {
		v.ConversationStarters = starters
	}
	if meta, ok := body["meta"].(map[string]any); ok {
		v.Meta = meta
	}
	// Pipeline flow-graph layout. Without this the pipeline editor's Save
	// returned 200 while silently discarding every node/edge edit (#135) —
	// the graph itself round-trips through `instructions` (the pipeline
	// YAML), this column carries the laid-out node/edge positions the
	// editor restores on reload.
	if pipelineSettings, ok := body["pipeline_settings"].(map[string]any); ok {
		v.PipelineSettings = pipelineSettings
	}

	ver, err := h.repo.UpdateVersion(r.Context(), projectID, applicationID, versionID, v)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, versionDetailsResponse(ver, user, strconv.FormatInt(ownerID, 10)))
}

func (h *Handler) DeleteVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")
	versionID := chi.URLParam(r, "versionID")

	if _, ok := tenantSchema(projectID); !ok {
		apierr.Write(w, apierr.BadRequest("invalid project id"))
		return
	}

	// Guard: block deletion of published/embedded versions
	if h.pool != nil {
		s, _ := tenantSchema(projectID)
		var status string
		err := h.pool.QueryRow(r.Context(), fmt.Sprintf(
			`SELECT status FROM %s.application_versions WHERE application_id = $1 AND id = $2`, s),
			applicationID, versionID).Scan(&status)
		if err == nil && (status == "published" || status == "embedded") {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": "Unpublish first. Cannot delete a published version.",
			})
			return
		}
	}

	if err := h.repo.DeleteVersion(r.Context(), projectID, applicationID, versionID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) SetDefaultVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	// UI sends PATCH with body {"version_id": 123}; fall back to URL path param for backward compat.
	versionID := chi.URLParam(r, "versionID")
	var body struct {
		VersionID string `json:"version_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err == nil && body.VersionID != "" {
		versionID = body.VersionID
	}

	if versionID == "" {
		apierr.Write(w, apierr.BadRequest("version_id is required"))
		return
	}

	if err := h.repo.SetDefaultVersion(r.Context(), projectID, applicationID, versionID); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) BatchReplaceVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	oldVersionID := chi.URLParam(r, "oldVersionID")
	newVersionID := chi.URLParam(r, "newVersionID")
	deleteOld := r.URL.Query().Get("delete_old") == "true"

	if err := h.repo.BatchReplaceVersion(r.Context(), projectID, oldVersionID, newVersionID, deleteOld); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GetVersionExpanded returns version details with expanded and unsecreted toolkit configurations.
// Authenticated via X-SECRET header (must match APPLICATION_SECRET_KEY env var).
func (h *Handler) GetVersionExpanded(w http.ResponseWriter, r *http.Request) {
	secretKey := os.Getenv("APPLICATION_SECRET_KEY")
	if secretKey == "" {
		apierr.Write(w, apierr.Internal("APPLICATION_SECRET_KEY not configured"))
		return
	}
	xSecret := r.Header.Get("X-SECRET")
	if xSecret == "" || xSecret != secretKey {
		apierr.Write(w, apierr.Unauthorized("invalid or missing X-SECRET header"))
		return
	}

	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")
	versionID := chi.URLParam(r, "versionID")

	if h.pool == nil {
		apierr.Write(w, apierr.Internal("database pool not available"))
		return
	}

	ctx := r.Context()
	s, ok := tenantSchema(projectID)
	if !ok {
		apierr.Write(w, apierr.BadRequest("invalid project id"))
		return
	}

	var id int
	var appID int
	var name, status, agentType string
	var instructions, welcomeMsg *string
	var llmSettingsJSON, metaJSON, startersJSON, pipelineSettingsJSON []byte
	var createdAt interface{}
	var authorID *int

	err := h.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT v.id, v.application_id, v.name, v.status, v.created_at,
			v.agent_type, v.instructions, v.welcome_message,
			COALESCE(v.llm_settings::text, '{}'), COALESCE(v.meta::text, '{}'),
			COALESCE(v.conversation_starters::text, '[]'),
			COALESCE(v.pipeline_settings::text, '{}'),
			v.author_id
		FROM %s.application_versions v
		WHERE v.application_id = $1 AND v.id = $2`, s), applicationID, versionID).Scan(
		&id, &appID, &name, &status, &createdAt,
		&agentType, &instructions, &welcomeMsg,
		&llmSettingsJSON, &metaJSON, &startersJSON, &pipelineSettingsJSON,
		&authorID,
	)
	if err != nil {
		apierr.Write(w, apierr.NotFound("version not found"))
		return
	}

	var llmSettings, meta, starters, pipelineSettings any
	// JSON was read from DB via COALESCE — cannot be invalid JSON
	_ = json.Unmarshal(llmSettingsJSON, &llmSettings)
	_ = json.Unmarshal(metaJSON, &meta)
	_ = json.Unmarshal(startersJSON, &starters)
	_ = json.Unmarshal(pipelineSettingsJSON, &pipelineSettings)

	instrVal := ""
	if instructions != nil {
		instrVal = *instructions
	}
	welcomeVal := ""
	if welcomeMsg != nil {
		welcomeVal = *welcomeMsg
	}

	secretsHandler := secrets.NewHandler(h.pool)

	// Fetch tools from entity_tool_mapping
	tools := make([]map[string]any, 0)
	toolRows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT etm.id, etm.tool_id, etm.entity_type, COALESCE(etm.selected_tools::text, '{}'),
			t.name, t.type, t.settings
		FROM %s.entity_tool_mapping etm
		LEFT JOIN %s.elitea_tools t ON t.id = etm.tool_id
		WHERE etm.entity_version_id = $1`, s, s), versionID)
	if err == nil {
		defer toolRows.Close()
		for toolRows.Next() {
			var etmID, toolID int
			var entityType, selectedToolsStr string
			var tName, tType *string
			var tConfig []byte
			if err := toolRows.Scan(&etmID, &toolID, &entityType, &selectedToolsStr, &tName, &tType, &tConfig); err != nil {
				continue
			}
			var selectedTools any
			// selectedToolsStr is COALESCE'd DB JSON — cannot fail
			_ = json.Unmarshal([]byte(selectedToolsStr), &selectedTools)
			var config map[string]any
			if tConfig != nil {
				// tConfig is DB-stored JSON — cannot fail
				_ = json.Unmarshal(tConfig, &config)
			}
			if config == nil {
				config = map[string]any{}
			}

			// Expand configurations in settings
			expandedSettings := h.expandToolSettings(ctx, s, projectID, config, secretsHandler)

			tool := map[string]any{
				"id":             etmID,
				"tool_id":        toolID,
				"entity_type":    entityType,
				"selected_tools": selectedTools,
				"settings":       expandedSettings,
			}
			if tName != nil {
				tool["name"] = *tName
			}
			if tType != nil {
				tool["type"] = *tType
			}
			tools = append(tools, tool)
		}
	}

	authorIDStr := ""
	if authorID != nil {
		authorIDStr = strconv.Itoa(*authorID)
	}

	// Also fetch from application_tools (sub-agent references)
	projIDInt, _ := strconv.Atoi(projectID)
	appToolRows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, name, type, settings::text
		FROM %s.application_tools
		WHERE application_version_id = $1`, s), versionID)
	if err == nil {
		defer appToolRows.Close()
		for appToolRows.Next() {
			var atID int
			var atName, atType, settingsStr string
			if err := appToolRows.Scan(&atID, &atName, &atType, &settingsStr); err != nil {
				continue
			}
			var settings any
			// settingsStr is DB-stored JSON — cannot fail
			_ = json.Unmarshal([]byte(settingsStr), &settings)
			tools = append(tools, map[string]any{
				"id":         atID,
				"name":       atName,
				"type":       atType,
				"settings":   settings,
				"author_id":  authorIDStr,
				"project_id": projIDInt,
			})
		}
	}

	resp := map[string]any{
		"id":                    strconv.Itoa(id),
		"application_id":        strconv.Itoa(appID),
		"name":                  name,
		"status":                status,
		"created_at":            createdAt,
		"agent_type":            agentType,
		"instructions":          instrVal,
		"welcome_message":       welcomeVal,
		"llm_settings":          llmSettings,
		"meta":                  meta,
		"conversation_starters": starters,
		"pipeline_settings":     pipelineSettings,
		"author_id":             authorIDStr,
		"tools":                 tools,
		"tags":                  []any{},
	}
	writeJSON(w, http.StatusOK, resp)
}

// expandToolSettings expands configuration references in tool settings.
// For fields like "github_configuration": {"elitea_title": "...", "private": ...},
// it fetches the full configuration from the database and resolves secrets.
func (h *Handler) expandToolSettings(ctx context.Context, schema, projectID string, settings map[string]any, secretsHandler *secrets.Handler) map[string]any {
	expanded := make(map[string]any, len(settings))
	for k, v := range settings {
		expanded[k] = v
	}

	for key, val := range settings {
		if !strings.HasSuffix(key, "_configuration") {
			continue
		}
		ref, ok := val.(map[string]any)
		if !ok {
			continue
		}
		title, _ := ref["elitea_title"].(string)
		if title == "" {
			continue
		}
		private, _ := ref["private"].(bool)

		// Look up configuration by elitea_title
		var configID int
		var configUUID, configType, configProjectID string
		var configData []byte
		var configShared bool

		err := h.pool.QueryRow(ctx, fmt.Sprintf(`
			SELECT id, COALESCE(uuid::text, ''), type, project_id, data, shared
			FROM %s.configuration
			WHERE elitea_title = $1
			LIMIT 1`, schema), title).Scan(
			&configID, &configUUID, &configType, &configProjectID, &configData, &configShared,
		)
		if err != nil {
			// Try shared configs if private lookup fails
			if private {
				continue
			}
			err = h.pool.QueryRow(ctx, fmt.Sprintf(`
				SELECT id, COALESCE(uuid::text, ''), type, project_id, data, shared
				FROM %s.configuration
				WHERE elitea_title = $1 AND shared = true
				LIMIT 1`, schema), title).Scan(
				&configID, &configUUID, &configType, &configProjectID, &configData, &configShared,
			)
			if err != nil {
				continue
			}
		}

		var data map[string]any
		// configData is DB-stored JSON from the configuration table — cannot be invalid
		_ = json.Unmarshal(configData, &data)
		if data == nil {
			data = map[string]any{}
		}

		// Resolve secrets in data
		for dk, dv := range data {
			sv, ok := dv.(string)
			if !ok {
				continue
			}
			if strings.HasPrefix(sv, "{{secret.") {
				resolved, err := secretsHandler.ResolveSecretValue(ctx, projectID, sv)
				if err == nil {
					data[dk] = resolved
				}
			}
		}

		// Build expanded configuration
		expandedConfig := make(map[string]any)
		expandedConfig["private"] = private
		expandedConfig["elitea_title"] = title
		expandedConfig["configuration_uuid"] = configUUID
		expandedConfig["configuration_project_id"] = configProjectID
		expandedConfig["configuration_type"] = configType
		for dk, dv := range data {
			expandedConfig[dk] = dv
		}
		expanded[key] = expandedConfig
	}

	return expanded
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	// connection already committed; ignore write error
	_ = json.NewEncoder(w).Encode(v)
}
