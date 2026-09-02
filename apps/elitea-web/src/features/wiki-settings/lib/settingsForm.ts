/**
 * Validating the DeepWiki toolkit settings before they are saved.
 *
 * WHY VALIDATION LIVES HERE AND NOT IN THE COMPONENT. The legacy screen parsed
 * the JSON inside its save handler and reported failures through a string
 * (`setSettingsError(\`Invalid JSON: ${err.message}\`)`), which means the only
 * way to test the rules was to drive the form. They are the rules that decide
 * whether a generation can find its repository at all, so they are a function.
 *
 * THE PARSE IS NOT THE ONLY CHECK, and that is the substance of this file. The
 * legacy code accepted any valid JSON object — including one with no repository
 * — and the failure surfaced much later, as a generation that ran and produced
 * nothing. A settings screen that accepts a configuration the feature cannot
 * use is worse than one that refuses it.
 *
 * TWO KINDS OF FINDING. `problems` block Save; `hints` do not. The model
 * settings are hints because a document without them is legal and may well
 * work — see ENGINE_FALLBACK_* below for what it costs when it does not.
 */
import { getConfiguredRepoIdentity, type ToolkitSettings } from '@/entities/wiki';

/**
 * The models the DeepWiki engine asks the platform gateway for when the
 * toolkit names none.
 *
 * MEASURED 2026-09-02 (PR #725). The gateway resolves a model PER PROJECT, so
 * a project with no row for these names answers
 * `404 model is not configured for this project`, and the generation
 * "completes" with no pages. Nothing on this screen said so: the only place
 * the refusal appeared was the gateway's own log.
 */
const ENGINE_FALLBACK_CHAT_MODEL = 'gpt-4o-mini';
const ENGINE_FALLBACK_EMBEDDING_MODEL = 'text-embedding-3-large';

/** What is wrong with a draft, in the operator's terms. */
export interface SettingsProblem {
  /** The field to attach the message to, or null for the document as a whole. */
  readonly field: string | null;
  readonly message: string;
}

/**
 * A setting whose ABSENCE the engine papers over with a hardcoded default.
 *
 * Separate from `SettingsProblem` on purpose: a hint never blocks Save. The
 * saved document is legal and the legacy screen accepted it, and a toolkit
 * whose project does resolve the fallback model works exactly as before — so
 * refusing it here would break a working configuration to warn about a
 * broken one. What it must not do is stay silent.
 */
export interface SettingsHint {
  /** The settings key that is absent. */
  readonly field: string;
  /** The model the engine asks the platform for instead. */
  readonly fallback: string;
}

export interface ParsedSettings {
  readonly settings: ToolkitSettings | null;
  readonly problems: readonly SettingsProblem[];
  readonly hints: readonly SettingsHint[];
}

/**
 * Parse and check a settings draft.
 *
 * Returns every problem rather than the first: an operator fixing a
 * configuration one message at a time, re-saving between each, is the
 * experience this avoids.
 */
export function parseSettingsDraft(draft: string): ParsedSettings {
  const trimmed = draft.trim();
  if (trimmed === '') {
    // An empty document is not the same as `{}`. Saving it would silently
    // clear a configuration the operator did not mean to touch.
    return {
      settings: null,
      problems: [{ field: null, message: 'Settings cannot be empty. Use {} to clear them.' }],
      hints: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return {
      settings: null,
      problems: [
        {
          field: null,
          message: `Not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
        },
      ],
      hints: [],
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      settings: null,
      problems: [{ field: null, message: 'Settings must be a JSON object.' }],
      hints: [],
    };
  }

  const settings = parsed as ToolkitSettings;
  const problems: SettingsProblem[] = [];

  // The one check the legacy screen did not make. Without a resolvable
  // repository a generation runs and finds nothing, and the operator learns
  // that minutes later from an empty wiki.
  const identity = getConfiguredRepoIdentity(null, settings, null);
  if (!identity?.repository) {
    problems.push({
      field: 'repository',
      message:
        'No repository is configured. Set one of github_repository, repository, repo, ' +
        'or an Azure DevOps organization/project/repository_id.',
    });
  }

  return { settings, problems, hints: modelHints(settings) };
}

/**
 * Whether a settings key holds a usable model name, under either of the two
 * names a settings screen may have stored it (`entities/wiki`'s alias rule:
 * the unprefixed name and its `toolkit_configuration_` twin), and treating an
 * empty string as absent the way the identity resolver does.
 */
function hasModelName(settings: ToolkitSettings, field: string): boolean {
  const source = settings as Record<string, unknown>;
  for (const name of [field, `toolkit_configuration_${field}`]) {
    const value = source[name];
    if (typeof value === 'string' && value.trim() !== '') return true;
  }
  return false;
}

/** One hint per model setting the engine would have to substitute a default for. */
function modelHints(settings: ToolkitSettings): SettingsHint[] {
  const hints: SettingsHint[] = [];
  if (!hasModelName(settings, 'llm_model')) {
    hints.push({ field: 'llm_model', fallback: ENGINE_FALLBACK_CHAT_MODEL });
  }
  if (!hasModelName(settings, 'embedding_model')) {
    hints.push({ field: 'embedding_model', fallback: ENGINE_FALLBACK_EMBEDDING_MODEL });
  }
  return hints;
}

/** A draft is savable when it parses and has no problems. */
export function canSaveSettings(parsed: ParsedSettings): boolean {
  return parsed.settings !== null && parsed.problems.length === 0;
}
