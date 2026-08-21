/**
 * Which optional backend surfaces this platform serves.
 *
 * The Go router registers no handler for five endpoints this SPA can build a
 * request for, and `api/openapi/v2.yaml` declares none of them either:
 *
 *   POST /elitea_core/generate_application_draft/prompt_lib/{projectId}
 *   POST /elitea_core/generate_project_context_draft/prompt_lib/{projectId}
 *   POST /elitea_core/generate_skill_draft/prompt_lib/{projectId}
 *   POST /elitea_core/predict_llm/prompt_lib/{projectId}
 *   GET  /elitea_core/pipeline_trigger/prompt_lib/{projectId}/pipeline/{v}/trigger
 *
 * chi answers `404 page not found` for every one of them, in every profile.
 * The route groups were gated on `RouterConfig` fields nothing ever assigned,
 * so they answered 404 before #126 removed them as well. The affordances that
 * call them can therefore never succeed, and the user reads a failure that no
 * setting can repair.
 *
 * The ported hooks, modals and API modules STAY. The backend gap is tracked
 * (#192 webhook trigger, #193 scheduled execution, #194 AI draft and predict),
 * and deleting the port would only mean writing it again. This module hides
 * the affordances until the endpoints land. Turn a capability on in the same
 * change that mounts its routes.
 */

/** One optional backend surface. */
export type BackendCapability = 'aiGeneration' | 'pipelineTriggers';

/**
 * What this build serves.
 *
 * `aiGeneration` covers the agent draft, the project-context draft, the skill
 * draft, and `predict_llm`. `predict_llm` has two senders: the skill test run,
 * and the pipeline AI assistant. The assistant is gated inside
 * `features/pipelines/ui/AIAssistantInput.tsx`, the component that owns the
 * trigger, so every call site is covered by one check.
 * `pipelineTriggers` covers the webhook and scheduled trigger types, and the
 * trigger read the application-information panel makes. The Chat Message
 * trigger type calls no endpoint and stays available.
 */
const SERVED: Readonly<Record<BackendCapability, boolean>> = {
  aiGeneration: false,
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
