/**
 * The form model shared by Settings › AI Personality and Settings › Memory.
 *
 * Both pages are one Formik form over the SAME record — the author profile —
 * and both save it with `PUT /social/author`. Baseline:
 * `EliteaUI/src/[fsd]/features/settings/lib/helpers/profile.helpers.js:17-95`.
 *
 * Two deliberate differences from that baseline, both forced by THIS backend:
 *
 *  1. `default_context_management` / `default_summarization` are nested INSIDE
 *     `personalization`, not sent as sibling top-level keys.
 *     `UpdateAuthor` (services/elitea-main/internal/api/v2/social/handler.go)
 *     decodes the body into `map[string]any` and reads only
 *     `name`/`description`/`avatar`/`personalization`; every other top-level
 *     key is silently dropped. `GET` likewise returns only `personalization`.
 *     Same reasoning — and same wire shape — as the sibling
 *     `lib/profile/profileUtils.ts`, which this file cannot simply reuse
 *     because that model has no per-persona instructions map and no
 *     context-editing flag.
 *  2. The PUT REPLACES the whole `personalization` blob (the upsert's
 *     `personalization = EXCLUDED.personalization`). A payload built from one
 *     page's fields alone would therefore wipe the other page's settings — and
 *     `name`/`description`/`avatar` are upserted from the body too, so
 *     omitting them blanks the stored avatar/description. `buildAuthorUpdate`
 *     below carries all of it forward.
 */
import { DEFAULT_CONTEXT_STRATEGY } from '@/features/settings/lib/profile/context-budget/constants';

import { DEFAULT_PERSONA, emptyPersonalityInstructions } from './personaOptions';

/** `enable_context_editing`'s default — baseline `context-budget/lib/constants.js:22`. */
const DEFAULT_ENABLE_CONTEXT_EDITING = false;

/** `DEFAULT_MAX_TOKENS_CUSTOM` — baseline `shared/lib/constants/llmSettings.constants.js:8`. */
const DEFAULT_TARGET_SUMMARY_TOKENS = 4096;

/** A numeric field is briefly `''` while the user clears it (see `handleConvertToNumberChange`). */
type NumericFieldValue = number | '';

interface SummaryLlmSettings {
  instructions: string;
  model_name: string;
  model_project_id: string | null;
  max_tokens: NumericFieldValue;
}

export interface SettingsProfileFormValues {
  persona: string;
  /** Instructions are stored PER PERSONA, keyed by persona id (baseline #5392). */
  personality_instructions: Record<string, string>;
  context_enabled: boolean;
  max_context_tokens: NumericFieldValue;
  preserve_recent_messages: NumericFieldValue;
  enable_context_editing: boolean;
  enable_summarization: boolean;
  summary_llm_settings: SummaryLlmSettings;
}

/** The author record as this app reads it back from `GET /social/author`. */
export interface AuthorProfile {
  name?: string;
  description?: string;
  avatar?: string;
  personalization?: unknown;
}

interface Personalization {
  persona?: string;
  personality_instructions?: Record<string, string>;
  default_context_management?: Record<string, unknown>;
  default_summarization?: Record<string, unknown>;
}

function readPersonalization(author: AuthorProfile | undefined): Personalization {
  const raw = author?.personalization;
  if (raw === null || typeof raw !== 'object') return {};
  return raw;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function serializeSummarization(
  s: Record<string, unknown>,
  fallbackProjectId: string | null,
): { enable_summarization: boolean; summary_llm_settings: SummaryLlmSettings } {
  const projectId = s.summary_model_project_id;
  return {
    enable_summarization: asBoolean(s.enable_summarization, DEFAULT_CONTEXT_STRATEGY.ENABLE_SUMMARIZATION),
    summary_llm_settings: {
      instructions: asString(s.summary_instructions, ''),
      model_name: asString(s.summary_model_name, ''),
      model_project_id: typeof projectId === 'string' ? projectId : fallbackProjectId,
      max_tokens: asNumber(s.target_summary_tokens, DEFAULT_TARGET_SUMMARY_TOKENS),
    },
  };
}

/**
 * `GET /social/author` → Formik values.
 *
 * The per-persona map is merged OVER a full set of empty slots so every
 * persona key always exists, exactly as the baseline does — a persona whose
 * key is missing from the stored map must still show an empty editable field,
 * not `undefined`.
 */
export function serializeSettingsProfile(
  author: AuthorProfile | undefined,
  fallbackProjectId?: string,
): SettingsProfileFormValues {
  const p = readPersonalization(author);
  const cm = p.default_context_management ?? {};
  const s = p.default_summarization ?? {};

  return {
    persona: asString(p.persona, DEFAULT_PERSONA),
    personality_instructions: { ...emptyPersonalityInstructions(), ...p.personality_instructions },
    context_enabled: asBoolean(cm.enabled, DEFAULT_CONTEXT_STRATEGY.ENABLED),
    max_context_tokens: asNumber(cm.max_context_tokens, DEFAULT_CONTEXT_STRATEGY.MAX_CONTEXT_TOKENS),
    preserve_recent_messages: asNumber(
      cm.preserve_recent_messages,
      DEFAULT_CONTEXT_STRATEGY.PRESERVE_RECENT_MESSAGES,
    ),
    enable_context_editing: asBoolean(cm.enable_context_editing, DEFAULT_ENABLE_CONTEXT_EDITING),
    ...serializeSummarization(s, fallbackProjectId ?? null),
  };
}

/** Formik values → the `personalization` blob (both pages' fields, one object). */
export function deserializeSettingsProfile(values: SettingsProfileFormValues): Record<string, unknown> {
  const s = values.summary_llm_settings;
  return {
    persona: values.persona,
    personality_instructions: values.personality_instructions,
    default_context_management: {
      enabled: values.context_enabled,
      max_context_tokens: values.max_context_tokens,
      preserve_recent_messages: values.preserve_recent_messages,
      enable_context_editing: values.enable_context_editing,
    },
    default_summarization: {
      enable_summarization: values.enable_summarization,
      summary_instructions: s.instructions,
      summary_model_name: s.model_name,
      summary_model_project_id: s.model_project_id,
      target_summary_tokens: s.max_tokens,
    },
  };
}

/**
 * The full `PUT /social/author` body: the edited fields laid over everything
 * the fetched profile already carried. See this module's header for why every
 * one of those carry-forwards is load-bearing against this backend.
 */
export function buildAuthorUpdate(
  author: AuthorProfile | undefined,
  values: SettingsProfileFormValues,
): { name?: string; description?: string; avatar?: string; personalization: Record<string, unknown> } {
  return {
    ...(author?.name === undefined ? {} : { name: author.name }),
    ...(author?.description === undefined ? {} : { description: author.description }),
    ...(author?.avatar === undefined ? {} : { avatar: author.avatar }),
    personalization: {
      ...readPersonalization(author),
      ...deserializeSettingsProfile(values),
    },
  };
}
