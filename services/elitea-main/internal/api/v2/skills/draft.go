package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/predict"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

// Predictor is the narrow slice of v2predict.Predictor that draft generation
// needs. cfg.Predictor (v2predict.Predictor) satisfies this directly.
type Predictor interface {
	Predict(ctx context.Context, req predict.Request) (predict.Response, error)
}

// SkillDraft is the shape the frontend's generateSkillDraft() casts the
// response to directly (apps/elitea-web SkillDraft type) — deliberately NOT
// the raw predict.Response envelope the generic predict handler returns.
type SkillDraft struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Instructions string   `json:"instructions"`
	Tags         []string `json:"tags"`
}

// DraftHandler served POST /generate_skill_draft/prompt_lib/{projectID}.
//
// NOTE(#126): that route was registered behind a nil RouterConfig.Predictor
// and answered 404 in every deployment; step 1 of #126 deleted it with the
// rest of the prototype indexer transport. This handler is deliberately kept —
// unlike v2predict/v2chat/v2pipelines it does not depend on that transport,
// only on the narrow Predictor interface above, which the current runtime
// could supply — but it now has NO CALLER. Its unit tests still pass, which is
// exactly how dead code stays invisible here (#134, #136, #149). #194 records
// that it needs either a supplier or a deliberate deletion.
type DraftHandler struct {
	predictor Predictor
}

func NewDraftHandler(predictor Predictor) *DraftHandler {
	return &DraftHandler{predictor: predictor}
}

type generateDraftRequest struct {
	UserDescription string `json:"user_description"`
}

func (h *DraftHandler) GenerateDraft(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var req generateDraftRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	if strings.TrimSpace(req.UserDescription) == "" {
		apierr.Write(w, apierr.BadRequest("user_description is required"))
		return
	}

	if h.predictor == nil {
		apierr.Write(w, apierr.Internal("draft generation is not configured"))
		return
	}

	resp, err := h.predictor.Predict(r.Context(), predict.Request{
		ProjectID: projectID,
		Input:     buildSkillDraftPrompt(req.UserDescription),
	})
	if err != nil {
		apierr.Write(w, err)
		return
	}

	draft, err := parseSkillDraft(resp.Content)
	if err != nil {
		apierr.Write(w, apierr.Internal("failed to parse generated skill draft: "+err.Error()))
		return
	}
	writeJSON(w, http.StatusOK, draft)
}

func buildSkillDraftPrompt(userDescription string) string {
	return fmt.Sprintf(`You are drafting a reusable "skill" for an AI agent platform. A skill has a short name, a one-sentence description, natural-language instructions the agent will follow, and a small set of topical tags.

Based on the request below, respond with ONLY a single JSON object (no markdown code fences, no commentary) with exactly these keys: "name" (string), "description" (string), "instructions" (string), "tags" (array of short lowercase strings).

Request: %s`, userDescription)
}

func parseSkillDraft(content string) (SkillDraft, error) {
	content = strings.TrimSpace(content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start == -1 || end == -1 || end < start {
		return SkillDraft{}, fmt.Errorf("no JSON object found in model response")
	}

	var draft SkillDraft
	if err := json.Unmarshal([]byte(content[start:end+1]), &draft); err != nil {
		return SkillDraft{}, err
	}
	if draft.Tags == nil {
		draft.Tags = []string{}
	}
	return draft, nil
}
