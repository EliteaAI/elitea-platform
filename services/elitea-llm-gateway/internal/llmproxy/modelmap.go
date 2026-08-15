// modelmap.go — the single point where the model id a CALLER sends becomes the
// model name the PROVIDER receives (issue #317).
//
// GET /llm/v1/models advertises each configured model under its elitea_title, a
// user-authored label. The provider only knows the row's data.name. The two are
// independent by construction, so a caller that picks a model out of the
// advertised list used to send the provider a name it does not recognise. This
// file maps the one onto the other, on every dialect, before dispatch.
//
// The legacy LiteLLM proxy had the same two-name model: it registered a
// deployment with an addressable `model_name` and a separate provider
// `litellm_params.model`, and translated the first into the second on the way
// out. Nothing replaced that translation when LiteLLM was removed.

package llmproxy

import (
	"context"
	"net/http"

	"github.com/maximhq/bifrost/core/schemas"
)

// modelLookup is the outcome of mapping a caller's model id for one project.
type modelLookup int

const (
	// modelSetUnknown means the project's model set could not be read at all:
	// no project on the request, no database, or a query failure with nothing
	// cached. The caller's model is then forwarded UNCHANGED.
	modelSetUnknown modelLookup = iota
	// modelNotAdvertised means the model set was read and holds no such model.
	modelNotAdvertised
	// modelResolved means the id maps to a provider model name.
	modelResolved
)

// resolve maps a caller-visible model id onto the provider model name to
// dispatch for projectID. ids are the candidate spellings of one request model,
// most specific first (see requestModelCandidates); the first candidate that
// names an advertised model wins.
//
// A candidate matches on the advertised id (elitea_title) first, and on the
// row's own provider model name (data.name) second. Both name the SAME row, so
// accepting the second keeps a caller that already sends wire names working
// while the advertised list stays callable. It never widens the set: a name
// that no configured row carries still resolves to modelNotAdvertised.
func (m *ModelResolver) resolve(ctx context.Context, projectID string, ids []string) (string, modelLookup) {
	models, known := m.list(ctx, projectID)
	if !known {
		return "", modelSetUnknown
	}
	for _, id := range ids {
		if id == "" {
			continue
		}
		for _, mo := range models {
			if mo.ID == id {
				return mo.providerModel, modelResolved
			}
		}
		for _, mo := range models {
			if mo.providerModel == id {
				return mo.providerModel, modelResolved
			}
		}
	}
	return "", modelNotAdvertised
}

// requestModelCandidates lists the spellings that can name an advertised model,
// most specific first.
//
// bifrost splits a "provider/model" request string before a handler sees it
// (schemas.ParseModelString), so a request for "openai/gpt-4o" arrives as the
// pair ("openai", "gpt-4o"). An advertised id can itself carry that prefix —
// preflight's StaticLegacyModels advertises "openai/gpt-4o" — so the rejoined
// form must be tried before the bare one, or such an id would 404 against the
// very list that advertises it.
func requestModelCandidates(provider schemas.ModelProvider, model string) []string {
	if provider == "" || model == "" {
		return []string{model}
	}
	return []string{string(provider) + "/" + model, model}
}

// mapModel rewrites provider and model in place, from what the caller sent to
// what the provider accepts. It reports whether the request may continue; when
// it returns false it has already written the response.
//
// EVERY /llm dialect that carries a model MUST call it after it decodes the
// request and BEFORE the budget gate. Ordering matters twice: the provider must
// never see an unmapped title, and the cost tables are keyed by the provider's
// own model name, so a budget check or a usage record made before the mapping
// would price the wrong model.
//
// The three outcomes are:
//   - resolved — provider and model become the mapped pair.
//   - not advertised — 404, so an unknown model fails at the gateway with an
//     OpenAI-shaped error instead of at the provider with an opaque one.
//   - set unknown — the pair is left untouched. The gateway cannot prove the
//     model is wrong, and failing here would turn a database blip into a total
//     inference outage; this is the pre-#317 behaviour, kept as the degraded
//     path only.
//
// A Handler built without a model resolver maps nothing: it has no list to
// advertise either, so list and dispatch still agree.
//
// Callers pass the two fields of a decoded request. Every call site holds a
// non-nil request: bifrost's ToBifrost*Request converters return nil only for a
// nil receiver, and each handler builds the receiver as a local value (or, on
// the multipart routes, checks the builder's error first). Keep that true —
// taking the address of a field of a nil request panics at the call site.
func (h *Handler) mapModel(
	w http.ResponseWriter,
	ctx context.Context,
	provider *schemas.ModelProvider,
	model *string,
) bool {
	if h.models == nil {
		return true
	}
	projectID := identityProjectFromCtx(ctx)
	target, outcome := h.models.resolve(ctx, projectID, requestModelCandidates(*provider, *model))
	switch outcome {
	case modelResolved:
		// The mapped name can carry its own provider prefix (e.g.
		// "openai/gpt-4o"). Re-split it, keeping the request's provider as the
		// default so an unprefixed wire name does not lose it.
		p, mdl := schemas.ParseModelString(target, *provider)
		*provider, *model = p, mdl
		return true
	case modelNotAdvertised:
		h.logger.WarnContext(ctx, "model is not configured for this project",
			"project_id", projectID, "model", *model)
		writeError(w, http.StatusNotFound, "invalid_request_error",
			"the model `"+*model+"` does not exist or you do not have access to it",
			"model_not_found")
		return false
	default: // modelSetUnknown
		h.logger.WarnContext(ctx, "model set unavailable; forwarding the caller's model unmapped",
			"project_id", projectID, "model", *model)
		return true
	}
}
