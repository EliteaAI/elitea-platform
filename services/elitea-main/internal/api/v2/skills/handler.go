package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"gopkg.in/yaml.v3"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

// SkillVersion is the single "base" version of a skill's content. The
// platform ships one implicit version per skill today (see issue #37); real
// multi-version support is a tracked fast-follow, not built here.
type SkillVersion struct {
	ID           string   `json:"id,omitempty"`
	Name         string   `json:"name"`
	Instructions string   `json:"instructions"`
	Tags         []string `json:"tags"`
}

type Skill struct {
	ID          string         `json:"id"`
	ProjectID   string         `json:"project_id"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Type        string         `json:"type"`
	Config      map[string]any `json:"config,omitempty"`
	IsDefault   bool           `json:"is_default"`
	// Instructions/Tags mirror the base version's content at the top level
	// for convenience; Versions/VersionDetails carry the same data in the
	// shape the frontend actually reads (skill.version_details ?? skill.versions[0]).
	Instructions   string         `json:"instructions,omitempty"`
	Tags           []string       `json:"tags,omitempty"`
	Versions       []SkillVersion `json:"versions,omitempty"`
	VersionDetails *SkillVersion  `json:"version_details,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

// skillVersionInput lets Create accept the {versions: [{name, instructions, tags}]}
// shape the frontend's createSkill() sends, distinct from Update's flat shape.
type skillVersionInput struct {
	Name         string   `json:"name,omitempty"`
	Instructions string   `json:"instructions,omitempty"`
	Tags         []string `json:"tags,omitempty"`
}

type createRequest struct {
	Name         string              `json:"name"`
	Description  string              `json:"description"`
	Instructions string              `json:"instructions,omitempty"`
	Tags         []string            `json:"tags,omitempty"`
	Versions     []skillVersionInput `json:"versions,omitempty"`
}

func (r createRequest) toSkill() Skill {
	sk := Skill{Name: r.Name, Description: r.Description, Instructions: r.Instructions, Tags: r.Tags}
	if len(r.Versions) > 0 {
		if sk.Instructions == "" {
			sk.Instructions = r.Versions[0].Instructions
		}
		if sk.Tags == nil {
			sk.Tags = r.Versions[0].Tags
		}
	}
	return sk
}

type ListParams struct {
	Page      int
	PageSize  int
	Query     string
	SortBy    string
	SortOrder string
}

type ListResponse struct {
	Items      []Skill `json:"items"`
	Total      int     `json:"total"`
	Page       int     `json:"page"`
	PageSize   int     `json:"page_size"`
	TotalPages int     `json:"total_pages"`
}

type Repository interface {
	List(ctx context.Context, projectID string, params ListParams) (ListResponse, error)
	Get(ctx context.Context, projectID, skillID string) (Skill, error)
	GetByName(ctx context.Context, projectID, name string) (Skill, bool, error)
	Create(ctx context.Context, projectID string, skill Skill) (Skill, error)
	Update(ctx context.Context, projectID, skillID string, skill Skill) (Skill, error)
	Delete(ctx context.Context, projectID, skillID string) error
}

type Handler struct {
	repo Repository
}

func NewHandler(repo Repository) *Handler {
	return &Handler{repo: repo}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{skillID}", h.Get)
	r.Put("/{skillID}", h.Update)
	r.Delete("/{skillID}", h.Delete)
	return r
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	params := ListParams{
		Page:      page,
		PageSize:  pageSize,
		Query:     strings.TrimSpace(r.URL.Query().Get("query")),
		SortBy:    r.URL.Query().Get("sort_by"),
		SortOrder: r.URL.Query().Get("sort_order"),
	}

	resp, err := h.repo.List(r.Context(), projectID, params)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	skillID := chi.URLParam(r, "skillID")

	skill, err := h.repo.Get(r.Context(), projectID, skillID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, skill)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	created, err := h.repo.Create(r.Context(), projectID, req.toSkill())
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	skillID := chi.URLParam(r, "skillID")

	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	updated, err := h.repo.Update(r.Context(), projectID, skillID, req.toSkill())
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	skillID := chi.URLParam(r, "skillID")

	if err := h.repo.Delete(r.Context(), projectID, skillID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- Import / Export ---------------------------------------------------------
//
// Both round-trip the same YAML-frontmatter-plus-markdown-body format the
// frontend's import wizard parses client-side for preview
// (apps/elitea-web parseMdFrontmatter / the old app's parseMdFrontmatter):
//
//	---
//	name: ...
//	description: ...
//	tags: [...]
//	---
//	<instructions body>

type skillFrontmatter struct {
	Name        string   `yaml:"name"`
	Description string   `yaml:"description"`
	Tags        []string `yaml:"tags,omitempty"`
}

var frontmatterPattern = regexp.MustCompile(`(?s)^---\r?\n(.*?)\r?\n---\r?\n?(.*)$`)

func serializeSkillMarkdown(sk Skill) (string, error) {
	fm := skillFrontmatter{Name: sk.Name, Description: sk.Description, Tags: sk.Tags}
	yamlBytes, err := yaml.Marshal(fm)
	if err != nil {
		return "", fmt.Errorf("render frontmatter: %w", err)
	}
	return "---\n" + string(yamlBytes) + "---\n" + sk.Instructions, nil
}

func parseSkillMarkdown(content string) (name, description, instructions string, tags []string, err error) {
	content = strings.TrimPrefix(content, "\ufeff")
	content = strings.TrimLeft(content, " \t\r\n")
	if !strings.HasPrefix(content, "---") {
		return "", "", "", nil, fmt.Errorf("file is missing required metadata: must start with a YAML frontmatter block (enclosed in ---)")
	}

	m := frontmatterPattern.FindStringSubmatch(content)
	if m == nil {
		return "", "", "", nil, fmt.Errorf("invalid md format: missing closing ---")
	}

	var fm skillFrontmatter
	if err := yaml.Unmarshal([]byte(m[1]), &fm); err != nil {
		return "", "", "", nil, fmt.Errorf("invalid frontmatter: %w", err)
	}
	if fm.Name == "" || fm.Description == "" {
		return "", "", "", nil, fmt.Errorf(`frontmatter must contain "name" and "description"`)
	}

	return fm.Name, fm.Description, strings.TrimSpace(m[2]), fm.Tags, nil
}

func sanitizeFilename(name string) string {
	var b strings.Builder
	for _, ch := range strings.TrimSpace(name) {
		switch {
		case ch >= 'a' && ch <= 'z', ch >= 'A' && ch <= 'Z', ch >= '0' && ch <= '9', ch == '-', ch == '_', ch == ' ':
			b.WriteRune(ch)
		default:
			b.WriteRune('_')
		}
	}
	result := strings.TrimSpace(b.String())
	if result == "" {
		return "skill"
	}
	return result
}

// maxImportBytes bounds the multipart/JSON body accepted by Import.
const maxImportBytes = 10 << 20 // 10MiB

// Import accepts a .md file (multipart form field "file") OR a JSON
// {content, filename} body, matching skillsApi.ts/skillsApi.js's skillImport
// contract. Only .md is accepted; a duplicate skill name reuses the existing
// skill and returns a `notice` field instead of erroring.
func (h *Handler) Import(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	content, filename, err := readImportPayload(r)
	if err != nil {
		apierr.Write(w, apierr.BadRequest(err.Error()))
		return
	}

	if filename != "" && !strings.HasSuffix(strings.ToLower(filename), ".md") {
		apierr.Write(w, apierr.BadRequest("only .md files can be imported"))
		return
	}

	name, description, instructions, tags, err := parseSkillMarkdown(content)
	if err != nil {
		apierr.Write(w, apierr.BadRequest(err.Error()))
		return
	}

	if existing, found, lookupErr := h.repo.GetByName(r.Context(), projectID, name); lookupErr == nil && found {
		writeJSON(w, http.StatusOK, skillWithNotice{
			Skill:  existing,
			Notice: fmt.Sprintf("A skill named %q already exists; reusing it.", name),
		})
		return
	}

	created, err := h.repo.Create(r.Context(), projectID, Skill{
		Name:         name,
		Description:  description,
		Instructions: instructions,
		Tags:         tags,
	})
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

type skillWithNotice struct {
	Skill
	Notice string `json:"notice"`
}

func readImportPayload(r *http.Request) (content, filename string, err error) {
	contentType := r.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "multipart/") {
		if parseErr := r.ParseMultipartForm(maxImportBytes); parseErr != nil {
			return "", "", fmt.Errorf("invalid multipart form: %w", parseErr)
		}
		file, header, formErr := r.FormFile("file")
		if formErr == nil {
			defer func() { _ = file.Close() }()
			body, readErr := io.ReadAll(io.LimitReader(file, maxImportBytes))
			if readErr != nil {
				return "", "", fmt.Errorf("failed to read uploaded file: %w", readErr)
			}
			return string(body), header.Filename, nil
		}
	}

	var body struct {
		Content  string `json:"content"`
		Filename string `json:"filename"`
	}
	if decodeErr := json.NewDecoder(io.LimitReader(r.Body, maxImportBytes)).Decode(&body); decodeErr != nil || body.Content == "" {
		return "", "", fmt.Errorf("missing file or content")
	}
	return body.Content, body.Filename, nil
}

// Export renders the skill's base version as a markdown blob (YAML
// frontmatter + instructions body) matching skillExportMd's contract: a
// text/markdown body with a Content-Disposition filename header the
// frontend parses to name the downloaded file.
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	skillID := chi.URLParam(r, "skillID")

	sk, err := h.repo.Get(r.Context(), projectID, skillID)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	content, err := serializeSkillMarkdown(sk)
	if err != nil {
		apierr.Write(w, apierr.Internal("failed to render skill markdown"))
		return
	}

	filename := sanitizeFilename(sk.Name) + ".md"
	w.Header().Set("Content-Type", "text/markdown")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(content))
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
