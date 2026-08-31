/**
 * Which optional backend surfaces this platform serves.
 *
 * The Go router registers no handler for four endpoints this SPA can build a
 * request for, and `api/openapi/v2.yaml` declares none of them either:
 *
 *   POST /elitea_core/generate_application_draft/prompt_lib/{projectId}
 *   POST /elitea_core/generate_project_context_draft/prompt_lib/{projectId}
 *   POST /elitea_core/generate_skill_draft/prompt_lib/{projectId}
 *   GET  /elitea_core/pipeline_trigger/prompt_lib/{projectId}/pipeline/{v}/trigger
 *
 * chi answers `404 page not found` for every one of them, in every profile.
 * The route groups were gated on `RouterConfig` fields nothing ever assigned,
 * so they answered 404 before #126 removed them as well. The affordances that
 * call them can therefore never succeed, and the user reads a failure that no
 * setting can repair.
 *
 * `predict_llm` USED to be the fifth entry on that list. It is now served, but
 * only in its blocking mode — which is why the single `aiGeneration` flag that
 * once covered it had to be split (see the three capabilities below).
 *
 * The ported hooks, modals and API modules STAY. The backend gap is tracked
 * (#192 webhook trigger, #193 scheduled execution, #194 AI draft generation).
 * This module hides the affordances until the endpoints land. Turn a
 * capability on in the same change that mounts its routes.
 */

/** One optional backend surface. */
export type BackendCapability =
  | 'aiGeneration'
  | 'llmPredictBlocking'
  | 'llmPredictStreaming'
  | 'pipelineTriggers';

/**
 * What this build serves.
 *
 * `aiGeneration` covers the three DRAFT endpoints only — the agent draft, the
 * project-context draft and the skill draft. None is routed.
 *
 * The other two both name `POST /elitea_core/predict_llm/prompt_lib/{id}`, and
 * they are separate flags because the backend serves ONE of its two modes:
 *
 *  - `llmPredictBlocking` — `await_task_timeout: 60`. The generated text comes
 *    back in the HTTP response. Served. Senders: the agent "Edit with AI"
 *    affordance (`features/agents/model/useAiEditAvailability.ts`) and the
 *    canvas mermaid quick-fix (`features/chat-messages/model/useMermaidQuickFix.ts`).
 *  - `llmPredictStreaming` — `await_task_timeout: 0`. The server starts a task
 *    and streams its output over an `application_predict` socket.io event. That
 *    transport does not exist in the Go stack at all, so this stays off no
 *    matter what the route answers. Senders: the pipeline AI assistant
 *    (`features/pipelines/ui/AIAssistantInput.tsx`,
 *    `.../settings/SimpleLLMInputItem.tsx`) and the skill test run
 *    (`pages/skills/EditSkill.tsx` via `features/skills/api/skillsApi.ts`).
 *
 * Collapsing these two back into one flag would light up an affordance whose
 * transport is missing, which is the same "affordance the user cannot repair"
 * this module exists to prevent.
 *
 * `pipelineTriggers` covers the webhook and scheduled trigger types, and the
 * trigger read the application-information panel makes. The Chat Message
 * trigger type calls no endpoint and stays available.
 */
const SERVED: Readonly<Record<BackendCapability, boolean>> = {
  aiGeneration: false,
  llmPredictBlocking: false,
  llmPredictStreaming: false,
  pipelineTriggers: false,
};

/**
 * Test-only overrides.
 *
 * A component test of a hidden affordance has to render it to test it. This
 * app forbids `vi.mock` (`elitea/no-vi-mock`), so the override is an explicit
 * setter, the same shape `get-config.ts` uses for its memo reset. Neither the
 * setter nor this variable reaches the public barrel.
 */
let testOverrides: Partial<Record<BackendCapability, boolean>> = {};

/** Reports whether this build serves one optional backend surface. */
export function hasBackendCapability(name: BackendCapability): boolean {
  return testOverrides[name] ?? SERVED[name];
}

/** Test-only. Kept off the public surface (see index.ts). */
export function setBackendCapabilityForTests(name: BackendCapability, served: boolean): void {
  testOverrides = { ...testOverrides, [name]: served };
}

/** Test-only. Restores every capability to what this build actually serves. */
export function resetBackendCapabilitiesForTests(): void {
  testOverrides = {};
}
