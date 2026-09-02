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
 */
import { getConfiguredRepoIdentity, type ToolkitSettings } from '@/entities/wiki';

/** What is wrong with a draft, in the operator's terms. */
export interface SettingsProblem {
  /** The field to attach the message to, or null for the document as a whole. */
  readonly field: string | null;
  readonly message: string;
}

export interface ParsedSettings {
  readonly settings: ToolkitSettings | null;
  readonly problems: readonly SettingsProblem[];
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
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      settings: null,
      problems: [{ field: null, message: 'Settings must be a JSON object.' }],
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

  return { settings, problems };
}

/** A draft is savable when it parses and has no problems. */
export function canSaveSettings(parsed: ParsedSettings): boolean {
  return parsed.settings !== null && parsed.problems.length === 0;
}
