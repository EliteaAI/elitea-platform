import type { LlmSettings } from '@/shared/api/generated/model';

/**
 * `version_details.llm_settings` — the model an agent or pipeline version
 * runs on, as its author picked it.
 *
 * Lives in `shared/api/` rather than in `entities/application-form` because
 * three layers need the same shape and none of them may import the others:
 * the draft (`entities/application-form/model/initialValues.ts`), the two
 * page mappers (`pages/agents/lib/`, `pages/pipelines/lib/`) and the model
 * picker that writes it (`widgets/`). `entities/application-form/index.ts`
 * is at the §3.5 slice-public-api cap (exactly 20 exports), so re-exporting
 * from there was not available even for the two layers allowed to reach it,
 * and `shared/` is the only layer everything above may import (R-L1,
 * `.dependency-cruiser.cjs:20-27`). `shared/` index budgets do not apply —
 * `isSliceIndex` in `scripts/lib/budgets-core.mjs` matches only
 * `features|entities|widgets|processes`.
 *
 * **Exactly these keys, and no others.** The Rust worker validates the
 * profile against a closed allow-list and refuses the whole turn with
 * `unsupported_profile` when it meets a key outside it
 * (`services/elitea-worker-rust/src/agents/assembly.rs`, `validate_model`).
 * Two keys that look available are deliberately absent:
 *
 * - `openai_compatible` — Configurations-owned. elitea-main deletes whatever
 *   the version carries and re-derives it from the project catalogue row
 *   (`services/elitea-main/internal/application/agentexecution/tools.go`,
 *   `resolveCurrentAgentModel`), so authoring it here can only ever be
 *   ignored or wrong.
 * - `top_p` / `top_k` — present in `api/openapi/v2.yaml` and therefore in
 *   the generated `LlmSettings` zod above, but NOT in the worker's
 *   allow-list. A version carrying `top_p` saves with a 200, freezes fine,
 *   and then fails at the worker on the first message. Do not surface a
 *   control for either.
 *
 * `reasoning_effort` is a real worker key but is not modelled here: the
 * generated `LlmSettings` object is a closed `zod.object` with no such field
 * and no `.passthrough()`, so writing it needs a `v2.yaml` edit first (its
 * own PR — a spec edit trips six separate CI gates).
 */
export interface AgentLlmSettings {
  /**
   * The catalogue alias, e.g. `qwen3.5`. Required: the worker's
   * `validate_model` rejects an absent or blank name outright, and
   * elitea-main only substitutes the project's catalogue default when the
   * name misses the catalogue entirely.
   */
  readonly model_name: string;
  /**
   * A JSON **number**, not a string. `ConfigModel.project_id`
   * (`shared/api/configurationsApi.ts`) is declared `string`, but the Go
   * catalogue marshals an int32 and the worker parses this field with
   * `positive_u32`, which hard-fails on a string. Always coerce with
   * `Number(...)` at the point the catalogue row is read.
   */
  readonly model_project_id: number;
  /** `-1` means "let the model decide"; otherwise a positive cap. */
  readonly max_tokens: number;
  /**
   * Mutually exclusive with `reasoning_effort` at the worker, which returns
   * `invalid_profile` when both are present. Omitted (not `undefined`) for a
   * reasoning model, which is why this is an optional key rather than a
   * nullable one.
   */
  readonly temperature?: number | undefined;
}

/** Every key `AgentLlmSettings` models, in the order the wire body writes them. */
const ALLOWED_KEYS = ['model_name', 'model_project_id', 'max_tokens', 'temperature'] as const;

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  // The catalogue and the export/import path both hand back numeric strings
  // for `model_project_id` (`internal/api/v2/eliteacore/handler.go` normalises
  // float64 to a string on export), so a stored version can legitimately hold
  // one and still be the settings the user picked.
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * A stored `llm_settings` blob (or any opaque record) -> the typed settings,
 * or `undefined` when it carries no usable model.
 *
 * Returning `undefined` rather than a half-filled object is the load-bearing
 * part: a version saved before this feature existed holds `{}`, and the
 * platform's own fallback to the project catalogue default is what makes
 * that version answer turns today. Anything this function returns is later
 * written back verbatim, so inventing a model here would replace a working
 * fallback with a guess.
 *
 * Keys outside `ALLOWED_KEYS` are dropped, not carried: a version imported
 * from elsewhere can hold `top_p` or `openai_compatible`, and re-sending
 * either is what turns a green save into a refused turn.
 */
export function toAgentLlmSettings(raw: unknown): AgentLlmSettings | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const modelName = record['model_name'];
  const projectId = readNumber(record['model_project_id']);
  if (typeof modelName !== 'string' || modelName === '' || projectId === undefined) return undefined;
  const maxTokens = readNumber(record['max_tokens']);
  const temperature = readNumber(record['temperature']);
  return {
    model_name: modelName,
    model_project_id: projectId,
    max_tokens: maxTokens ?? -1,
    ...(temperature === undefined ? {} : { temperature }),
  };
}

/**
 * The typed settings -> the generated request body's `llm_settings` value.
 *
 * Spread per key rather than `{ ...settings }`: under
 * `exactOptionalPropertyTypes` an optional key whose value type includes
 * `undefined` is not assignable to the generated schema's own optional key
 * (TS2375), the same reason `pages/pipelines/lib/editPipelineMappers.ts`'s
 * `buildChatLlmSettings` exists.
 */
export function toLlmSettingsBody(settings: AgentLlmSettings): LlmSettings {
  return {
    model_name: settings.model_name,
    model_project_id: settings.model_project_id,
    max_tokens: settings.max_tokens,
    ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
  };
}

/**
 * Key-by-key equality, for the unsaved-changes blocker.
 *
 * Object identity is not usable here: the picker hands back a fresh object
 * on every change, so an identity check reports "changed" forever, while a
 * check that skips these fields entirely reports "unchanged" after the user
 * has picked a different model — #133's failure, where a nav-blocker that
 * could not see a field let navigating away discard it in silence.
 */
export function areAgentLlmSettingsEqual(
  a: AgentLlmSettings | undefined,
  b: AgentLlmSettings | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return ALLOWED_KEYS.every((key) => a[key] === b[key]);
}
