/**
 * The one place a chosen catalogue row plus a set of dialog values becomes a
 * `version_details.llm_settings` object.
 *
 * Port of the baseline's `generateLLMSettings` + `cleanLLMSettings`
 * (`apps/elitea-ui/src/[fsd]/shared/lib/utils/llmSettings.utils.js:24-65`),
 * with the one rule the baseline did not have. The baseline wrote
 * `temperature` unconditionally and ADDED `reasoning_effort` on top for a
 * reasoning model; the Rust worker refuses that profile outright —
 * `services/elitea-worker-rust/src/agents/assembly.rs` returns
 * `invalid_profile` when `temperature` is present alongside a
 * `reasoning_effort` that is not `"none"`. Enforcing it here rather than at
 * the call site is the point of this module: a caller that forgets produces
 * an agent that saves with a 200, freezes fine, and then fails on its first
 * message with an error naming neither field.
 */
import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '@/shared/lib/constants';
import type { AgentLlmSettings } from '@/shared/api/agentLlmSettings';

/** The three facts about the chosen catalogue row that decide the profile. */
export interface ChosenCatalogueModel {
  readonly name: string;
  /**
   * The catalogue's own `project_id`. Typed loosely on purpose:
   * `ConfigModel.project_id` (`shared/api/configurationsApi.ts`) is declared
   * `string`, the Go catalogue marshals an int32, and the worker parses the
   * field with `positive_u32` — which hard-fails on a string. `Number(...)`
   * below is the single conversion point, so no caller has to know that.
   */
  readonly projectId: string | number | undefined;
  readonly supportsReasoning: boolean;
}

/**
 * Whatever tunables the caller is carrying: the version's current settings,
 * or the settings dialog's own values. `LLMSettingsValues` also carries
 * `reasoning_effort`, `steps_limit` and `webhook_secret`; none of them is
 * read here, and that is deliberate — `reasoning_effort` is not in the
 * generated `LlmSettings` schema yet, and the agent's step limit belongs to
 * `version_details.meta` where `ApplicationAdvanceSettings` already owns it.
 */
export interface AgentLlmTunables {
  readonly max_tokens?: number | string | undefined;
  readonly temperature?: number | undefined;
}

/** `parse_temperature` in `assembly.rs` accepts a finite `0.0..=1.0` and refuses everything else. */
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 1;

/** `-1` (Auto) or a positive cap; a blank or unparsable field falls back to Auto rather than to a number nobody chose. */
function readMaxTokens(raw: number | string | undefined): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  if (parsed === undefined || !Number.isFinite(parsed)) return DEFAULT_MAX_TOKENS;
  return parsed;
}

/**
 * Clamped, because the two ends disagree: `CreativitySlider` runs to 2.0
 * (`widgets/llm-model-selector/ui/settings/CreativitySlider.tsx`, `max={2}`)
 * while the worker's ceiling is 1.0. Saving what the slider allows would
 * produce a version that refuses its first turn, so the top of the slider's
 * travel is pinned to the top of the accepted range instead.
 */
function readTemperature(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_TEMPERATURE;
  return Math.min(Math.max(raw, MIN_TEMPERATURE), MAX_TEMPERATURE);
}

/**
 * `undefined` when the row cannot produce a valid profile — an empty name, or
 * a `project_id` that is absent or not a positive number. The caller emits
 * nothing in that case, which leaves the version carrying whatever it had:
 * for a version that carried nothing, that is the platform's own fallback to
 * the project catalogue default, and that fallback answering turns today is
 * exactly what must not be traded for a profile the worker will refuse.
 */
export function writeAgentLlmSettings(
  model: ChosenCatalogueModel,
  tunables: AgentLlmTunables | undefined,
): AgentLlmSettings | undefined {
  const projectId = Number(model.projectId);
  if (model.name === '' || !Number.isFinite(projectId) || projectId <= 0) return undefined;
  return {
    model_name: model.name,
    model_project_id: projectId,
    max_tokens: readMaxTokens(tunables?.max_tokens),
    // A reasoning model gets no `temperature` at all. It is not that the
    // value is wrong — it is that the key's presence is what the worker
    // rejects once `reasoning_effort` joins it, and the settings dialog
    // seeds `temperature` on mount for every model
    // (`LLMSettings.tsx`'s `computeMissingDefaults`) whether the slider for
    // it is on screen or not.
    ...(model.supportsReasoning ? {} : { temperature: readTemperature(tunables?.temperature) }),
  };
}
