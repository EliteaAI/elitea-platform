/**
 * `AgentDraft` — the shape `GenerateAgentReviewForm`/`GenerateAgentModal`
 * edit and submit, ported from the field set the baseline's
 * `GenerateAgentReviewForm.jsx` (`apps/elitea-ui/src/[fsd]/features/agent/
 * ui/generate-agent-modal/GenerateAgentReviewForm.jsx:20-35`) reads off
 * `draft` (`name`, `description`, `instructions`, `welcome_message`,
 * `conversation_starters`, `suggested_toolkits`, `suggested_mcp`,
 * `suggested_pipelines`, `suggested_agents`, `suggested_skills`).
 *
 * **REAL, CONFIRMED BACKEND GAP — read before wiring `onGenerate`.** The
 * baseline's `useGenerateAgentDraftMutation` (`apps/elitea-ui/src/[fsd]/
 * features/agent/api/generateAgentDraftApi.js:5-11`) posts
 * `{ projectId, user_description }` to
 * `/elitea_core/generate_application_draft/prompt_lib/{projectId}` and
 * (per every call site reading `draftData.name`/`.suggested_toolkits`/etc.)
 * expects a STRUCTURED draft object back. This app's generated client
 * exposes the SAME URL as `useGenerateAgentDraft`
 * (`shared/api/generated/applications/applications.ts:9163-9362`), but its
 * response type is `PredictResponse`
 * (`shared/api/generated/model/predictResponse.zod.ts`:
 * `{message_group_uid, content?, is_streaming, usage?, tool_calls?,
 * child_messages?}`) — a generic chat-completion envelope with NO `name`/
 * `description`/`instructions`/`welcome_message`/`suggested_*` fields at
 * all. Traced to the Go source, not assumed from the generated comment:
 * `services/elitea-main/internal/api/router.go:481-486` routes
 * `generate_application_draft`, `generate_skill_draft`, and
 * `generate_project_context_draft` to the exact SAME
 * `predictHandler.Predict` used for `webchat` (line 476); `internal/api/v2/
 * predict/handler.go:41-61`'s `Predict` decodes a generic
 * `predict.Request{input, variables, stream, mode}` and returns
 * `predictor.Predict(...)`'s generic `predict.Response` — there is no
 * per-route branching anywhere in that handler that would let the same
 * function return a bespoke "agent draft" shape for one route and a
 * generic chat completion for another. The Go-side "AI-assisted agent
 * scaffolding" feature has not been (re)implemented against the new
 * backend; only a same-URL generic predictor stub exists.
 *
 * `mapPredictResponseToAgentDraft` below is the DISCLOSED, minimal,
 * non-inventive response to that gap: since there is no structured
 * contract to decode, `suggested_toolkits`/`suggested_mcp`/
 * `suggested_pipelines`/`suggested_agents`/`suggested_skills` are always
 * empty (there is nothing to honestly populate them from — `ResourceSuggestions`
 * already renders `null` for an empty list, so this degrades gracefully,
 * it does not crash or fabricate suggestions) and `name`/`description`/
 * `welcome_message` are left blank for the user to fill in. The ONE
 * defensible, non-arbitrary mapping is `content` (the model's raw
 * generated text) into `instructions` — "whatever text came back becomes
 * the editable starting point for Instructions" is the same interpretation
 * a human pasting a completion into that field would make, not a
 * fabricated parse of fields that were never in the response.
 */

/** One AI-suggested resource the review form can offer to attach post-create. */
export interface SuggestedResource {
  readonly id: number | string;
  readonly name: string;
  /** Toolkit-only: the toolkit type string (`item.type` in the baseline's `SuggestionItem.jsx`). */
  readonly type?: string;
  readonly description?: string;
  /** Agent/pipeline-only: `'pipeline'` marks a suggested application as a pipeline (baseline `a.agent_type === 'pipeline'`). */
  readonly agent_type?: string;
}

export interface AgentDraft {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly welcome_message: string;
  readonly conversation_starters: readonly string[];
  readonly suggested_toolkits: readonly SuggestedResource[];
  readonly suggested_mcp: readonly SuggestedResource[];
  readonly suggested_pipelines: readonly SuggestedResource[];
  readonly suggested_agents: readonly SuggestedResource[];
  readonly suggested_skills: readonly SuggestedResource[];
}

export const EMPTY_AGENT_DRAFT: AgentDraft = {
  name: '',
  description: '',
  instructions: '',
  welcome_message: '',
  conversation_starters: [],
  suggested_toolkits: [],
  suggested_mcp: [],
  suggested_pipelines: [],
  suggested_agents: [],
  suggested_skills: [],
};

/**
 * `filterEmptyStrings` — the baseline's `common/applicationUtils.js`
 * helper (referenced by `GenerateAgentModal.jsx:240`,
 * `filterEmptyStrings(draftData.conversation_starters)`), not promoted to
 * any `entities/` slice by the Wave-2 promotion pass. Reproduced locally
 * (its entire behaviour is one filter predicate — trimmed, non-blank
 * strings only).
 */
export function filterEmptyStrings(values: readonly string[]): string[] {
  return values.filter((value) => value.trim().length > 0);
}

/**
 * See the module doc comment above for why this cannot honestly recover
 * `name`/`description`/`welcome_message`/`suggested_*` from a
 * `PredictResponse` — only `content` (if present) seeds `instructions`.
 */
export function mapPredictResponseToAgentDraft(content: string | undefined): AgentDraft {
  return {
    ...EMPTY_AGENT_DRAFT,
    instructions: content ?? '',
  };
}
