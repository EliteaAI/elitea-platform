import { useQuery } from '@tanstack/react-query';

import type { AgentLlmSettings } from '@/shared/api/agentLlmSettings';
import { hasBackendCapability } from '@/shared/config';

import {
  findServicePrompt,
  getServicePromptTypes,
  getServicePrompts,
  servicePromptDefaultsByKey,
} from '../api/aiEdit';

/**
 * THE GATE for the "Edit with AI" affordance.
 *
 * The brief for this port is explicit that the control must not ship in a
 * state where every click errors, and there are three independent ways it
 * would:
 *
 *  1. **The route.** `POST /elitea_core/predict_llm/prompt_lib/{projectId}`
 *     is not registered by this backend (#126 removed the group, #194 tracks
 *     the replacement) — `hasBackendCapability('aiGeneration')` is this
 *     app's existing switch for exactly that set of endpoints, and
 *     `GenerateAgentButton` is already hidden by it. Same switch here, so
 *     one change turns the whole AI surface on.
 *  2. **The prompt.** The base instruction the model is steered with is a
 *     Service Prompt, read from `/configurations/*`. Those routes only exist
 *     when `ELITEA_CONFIGURATIONS_ENABLED` is on — FALSE in a default
 *     install — so in a default install both queries below fail and no
 *     prompt resolves. An authored project/shared configuration wins; the
 *     type descriptor's `default_by_key` is the fallback. Neither present
 *     means no prompt, which means no affordance.
 *  3. **The model.** `predict_llm` is given an explicit `llm_settings`; the
 *     agent's own `version_details.llm_settings.model_name` is it. A version
 *     with no model configured cannot be asked to generate anything.
 *
 * `isAvailable` is the AND of all three. Nothing here retries: a 404 on the
 * configurations routes is a permanent property of the deployment, not a
 * transient failure, and retrying it on every mount would just be noise.
 */

/** The service-prompt key the agent-instructions edit is steered by. */
export const AI_EDIT_INSTRUCTIONS_PROMPT_KEY = 'edit_application_draft';

export interface UseAiEditAvailabilityOptions {
  readonly projectId: string | undefined;
  readonly modelSettings: AgentLlmSettings | null | undefined;
}

export interface UseAiEditAvailabilityResult {
  /** Render the affordance only when this is true. */
  readonly isAvailable: boolean;
  /** The resolved base prompt — empty string when none resolved. */
  readonly basePrompt: string;
  readonly modelName: string;
  readonly isResolving: boolean;
}

const AI_EDIT_QUERY_ROOT = ['agents', 'aiEdit'] as const;

export function useAiEditAvailability(options: UseAiEditAvailabilityOptions): UseAiEditAvailabilityResult {
  const { projectId, modelSettings } = options;

  const capabilityServed = hasBackendCapability('aiGeneration');
  const modelName = modelSettings?.model_name ?? '';
  // Nothing is fetched at all until the two cheap, synchronous conditions
  // hold — a build without the capability, or a version without a model,
  // must not issue configuration requests it can do nothing with.
  const enabled = capabilityServed && modelName !== '' && projectId !== undefined && projectId !== '';

  const promptTypes = useQuery({
    queryKey: [...AI_EDIT_QUERY_ROOT, 'promptTypes'],
    queryFn: ({ signal }) => getServicePromptTypes(signal),
    enabled,
    retry: false,
  });

  const prompts = useQuery({
    queryKey: [...AI_EDIT_QUERY_ROOT, 'prompts', projectId],
    queryFn: ({ signal }) => getServicePrompts(projectId ?? '', signal),
    enabled,
    retry: false,
  });

  const authored = findServicePrompt(prompts.data, AI_EDIT_INSTRUCTIONS_PROMPT_KEY);
  const fallback = servicePromptDefaultsByKey(promptTypes.data)[AI_EDIT_INSTRUCTIONS_PROMPT_KEY] ?? '';
  const basePrompt = authored.trim() !== '' ? authored : fallback;

  return {
    isAvailable: enabled && basePrompt.trim() !== '',
    basePrompt,
    modelName,
    isResolving: enabled && (promptTypes.isLoading || prompts.isLoading),
  };
}
