/**
 * Pure mode logic extracted from
 * `apps/elitea-ui/src/pages/Applications/Components/Tools/
 * ToolConfigurationForm.jsx` (Wave-2 promotion pass, Part 2's second file)
 * and its `Manual_Title`/`Create_Personal_Title`/`Create_Project_Title`
 * dependency, `apps/elitea-ui/src/hooks/useConfigurations.js:8-10`.
 *
 * That hook itself is NOT ported (it is RTK-Query pagination/search
 * orchestration, a features/-layer concern), but its three exported string
 * constants ARE — bundled into one `ConfigurationMode` object instead of
 * three separate top-level consts, both to stay within this slice's
 * index.ts export budget and to match this file's own `ToolEvents`-style
 * convention. **The exact string VALUES must match whatever this app's own
 * future `useConfigurations`-equivalent hook uses** — they are load-bearing
 * wire-adjacent identifiers a caller compares against, not display text.
 */
export const ConfigurationMode = {
  Manual: 'Manual_Title',
  CreatePersonal: 'Create_Personal_Title',
  CreateProject: 'Create_Project_Title',
} as const;

/** `CONFIGURATION_VIEW_OPTIONS` in the baseline — which picker widget a caller renders into the `configurationPicker` slot. */
export const CONFIGURATION_VIEW_OPTIONS = {
  ConfigurationSelect: 'configuration',
  CredentialsSelect: 'credentials',
} as const;

export function isCreateConfigurationMode(title: string | undefined): boolean {
  return title === ConfigurationMode.CreatePersonal || title === ConfigurationMode.CreateProject;
}

export function isManualOrCreateConfigurationMode(title: string | undefined): boolean {
  return title === ConfigurationMode.Manual || isCreateConfigurationMode(title);
}

/** The subset of a saved configuration's shape this file's matching logic needs. */
export interface ConfigurationSummary {
  readonly title?: string;
  readonly data?: { readonly title?: string };
}

/**
 * `doesConfigurationNotMatchAnything` in the baseline — true when the
 * current `configuration_title` is a real (non-manual, non-create) value
 * that doesn't correspond to any configuration in `originalConfigurations`,
 * once fetching has settled. Drives the "doesn't match any available
 * configurations" error state on the picker.
 */
export function configurationDoesNotMatchAnything(
  configurationTitle: string | undefined,
  isFetching: boolean,
  originalConfigurations: readonly ConfigurationSummary[],
): boolean {
  if (!configurationTitle) return false;
  if (isManualOrCreateConfigurationMode(configurationTitle)) return false;
  if (isFetching) return false;
  return !originalConfigurations.some(
    (config) => config.title === configurationTitle || config.data?.title === configurationTitle,
  );
}

/** The subset of a listed configuration's shape `matchConfigurationForTitle` needs. */
export interface ConfigurationRecord {
  readonly project_id?: string | number;
  readonly settings?: { readonly title?: string };
}

export type ConfigurationMatch =
  | { readonly kind: 'personal' | 'title'; readonly configuration: ConfigurationRecord }
  | { readonly kind: 'manual' };

/**
 * The decision core of the baseline's two configuration-matching
 * `useEffect`s: given the full configurations list and a target title,
 * prefer an exact personal-project title match, fall back to any
 * title-only match, and otherwise fall back to Manual. The baseline's
 * SIDE EFFECTS (`setConfiguration`/`editField` — writing the result back
 * into form state) are NOT ported; this returns the decision only, a
 * caller applies it however its own form library wants.
 */
export function matchConfigurationForTitle(
  configurations: readonly ConfigurationRecord[],
  title: string | undefined,
  personalProjectId: string | number | undefined,
  isPersonal: boolean | null | undefined,
): ConfigurationMatch {
  if (!title) return { kind: 'manual' };
  const personalMatch = isPersonal
    ? configurations.find((config) => config.project_id === personalProjectId && config.settings?.title === title)
    : undefined;
  if (personalMatch !== undefined) return { kind: 'personal', configuration: personalMatch };
  const titleMatch = configurations.find((config) => config.settings?.title === title);
  if (titleMatch !== undefined) return { kind: 'title', configuration: titleMatch };
  return { kind: 'manual' };
}
