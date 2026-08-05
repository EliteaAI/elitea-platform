/**
 * useResourcesConfig — single seam for the Help Center's admin-configurable
 * data: per-card enabled flags + links (consumed by `HelpCenterPage`), the
 * system version label, and the per-plugin version list (both consumed by
 * `ResourceVersionInfo`).
 *
 * BLOCKED behind a backend gap (issue #26 Key Decision #2; confirmed
 * findings A13-help-center #2 and #3). The old app sourced this from two Go
 * admin endpoints, via a hand-written RTK-query slice
 * (`EliteaUI/src/api/resources.js`):
 *   `GET /admin/system_info/prompt_lib`                     -> systemInfo.plugins
 *   `GET /admin/plugin_config_values/prompt_lib/resources`  -> configValues
 * Neither endpoint is annotated in this app's backend OpenAPI spec, so
 * orval never generates a typed client for them alongside the rest of
 * `src/shared/api/generated/admin/admin.ts` (compare that file's
 * `useGetPlatformSettings`/`useGetSupportAssistantConfig` — the exact
 * shape/query-key convention to follow once the spec exists). Per spec
 * §2.4 ("one hand-written fetch wrapper" for the whole app, the sole
 * documented exception being `shared/api/upload.ts`'s progress-reporting
 * XHR uploader), this codebase does not sanction a second hand-rolled
 * fetch call to plug the gap. So — deliberately, not an oversight — this
 * hook hardcodes every card `enabled`, no links, no version label, and no
 * plugins, and makes no network call at all.
 *
 * TO UNBLOCK (outside this cluster's file scope — `pages/help-center/**`
 * cannot define a new API client per §2.4 above): once the two endpoints
 * are annotated in the backend OpenAPI spec and orval regenerates
 * `admin.ts`, replace this hook's body with the two generated query hooks
 * mapped into this same `ResourcesConfigResult` shape, and delete
 * `DEFAULT_CONFIG_VALUES` (or keep it as the query's `placeholderData`).
 * `HelpCenterPage.tsx` and `ResourceVersionInfo.tsx` already consume this
 * hook's output as props/values, not the hardcoded constant directly, so
 * no further change is needed in either of those files at that point.
 */
import { useMemo } from 'react';

import { RESOURCE_CARD_CONFIGS } from './ResourceCardConfig';

/** A single plugin's name/version, as shown in `ResourceVersionInfo`'s tooltip. */
export interface ResourcesConfigPlugin {
  readonly name: string;
  readonly version?: string;
}

export interface ResourcesConfigResult {
  /** Raw admin config values, keyed by `*_enabled`/`*_links` (see `ResourceCardConfig.ts`). */
  readonly configValues: Record<string, unknown>;
  /** Pre-formatted "Version: X (date)" label — `''` when neither is configured. */
  readonly versionLabel: string;
  /** Per-plugin versions shown in `ResourceVersionInfo`'s tooltip. */
  readonly plugins: ReadonlyArray<ResourcesConfigPlugin>;
}

/** Every card enabled, no links, no version label, no plugins — see module doc. */
const DEFAULT_CONFIG_VALUES: Record<string, unknown> = Object.fromEntries(
  RESOURCE_CARD_CONFIGS.map((c): [string, boolean] => [c.enabledKey, true]),
);

/**
 * Returns the Help Center's current admin-configured data. Stable across
 * re-renders (no backing query yet — see module doc) so callers may safely
 * use the result in dependency arrays.
 */
export function useResourcesConfig(): ResourcesConfigResult {
  return useMemo(
    (): ResourcesConfigResult => ({
      configValues: DEFAULT_CONFIG_VALUES,
      versionLabel: '',
      plugins: [],
    }),
    [],
  );
}
