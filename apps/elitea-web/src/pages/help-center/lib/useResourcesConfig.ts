/**
 * useResourcesConfig — the Help Center's admin-configurable data: per-card
 * enabled flags and links, plus the version label.
 *
 * ## This was the blocked half of issue #26, and unit A14 unblocked it
 *
 * Until the admin Configuration port (issue #200) this hook made no network call
 * at all. The comment it carried was accurate about the SYMPTOM and wrong about
 * the cause: it read as an OpenAPI/orval gap, when in fact the endpoint behind it
 * did not work. `GET /admin/plugin_config_values/prompt_lib/resources` had a
 * route and answered 200 — with `max_file_size`, `max_context_length`,
 * `streaming_enabled` and a dozen other chat and upload limits, under no `values`
 * wrapper. It was a handler answering a different question than the page asked,
 * and no client that called it could have got a link out of it.
 *
 * It now serves what an administrator saved on Admin › Configuration ›
 * Resources, out of `centry.platform_config`
 * (`services/elitea-main/internal/api/v2/admin/config_values.go`). That is the
 * same route, the same section and the same public-read rule pylon has — pylon
 * exposes exactly one section to non-administrators, `_PUBLIC_SECTIONS =
 * {"resources"}` — so the contract is preserved rather than invented.
 *
 * ## Why this calls `eliteaFetch` rather than a generated hook
 *
 * `orval` builds from `v2.yaml`, which does not describe the admin-panel routes;
 * there is nothing for it to generate. The spec's "one hand-written fetch
 * wrapper" rule (§2.4) is about not introducing a SECOND transport — and
 * `eliteaFetch` is that one wrapper, the same one every `pages/admin/api/*`
 * module in this port uses. Annotating the admin surface in the OpenAPI spec and
 * moving to a generated client stays a clean follow-up; it is not what was
 * keeping the links off the page.
 *
 * ## What is still empty, and honestly so
 *
 * `plugins` — the per-plugin version list in `ResourceVersionInfo`'s tooltip.
 * Its source is `GET /admin/system_info/prompt_lib`, which in this service
 * returns a HARDCODED map naming `elitea_core` and `auth` at version "2.0.0"
 * with status "active". Those are Pylon plugin names, this service does not load
 * plugins, and the versions are invented. Rendering them would be worse than
 * rendering nothing, so this hook returns an empty list and the tooltip stays
 * closed. Fixing `system_info` to report something true is out of this unit's
 * scope and is reported separately.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import { unwrapBody } from '@/shared/api/unwrap';

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

/**
 * Every card enabled, no links — what the page shows while the read is in
 * flight, and if it fails.
 *
 * Failing OPEN is deliberate here and is the opposite of the choice a permission
 * check makes. These flags decide whether a documentation card is visible; a
 * transient error that hid the Help Center's contents would be a worse outcome
 * than showing the cards with no links, which is exactly what an unconfigured
 * platform shows anyway.
 */
const DEFAULT_CONFIG_VALUES: Record<string, unknown> = Object.fromEntries(
  RESOURCE_CARD_CONFIGS.map((c): [string, boolean] => [c.enabledKey, true]),
);

const RESOURCES_URL = '/admin/plugin_config_values/prompt_lib/resources';

/**
 * Builds the "Version: X (date)" label from the two values the administrator
 * sets on the Information card. Empty when neither is configured — a bare
 * "Version:" with nothing after it reads as a rendering bug.
 */
export function resourcesVersionLabel(configValues: Record<string, unknown>): string {
  const version = configValues.resources_information_version;
  const upgraded = configValues.resources_information_upgrade_date;
  const versionText = typeof version === 'string' ? version.trim() : '';
  const upgradedText = typeof upgraded === 'string' ? upgraded.trim() : '';
  if (versionText === '' && upgradedText === '') return '';
  if (upgradedText === '') return `Version: ${versionText}`;
  if (versionText === '') return `Last upgrade: ${upgradedText}`;
  return `Version: ${versionText} (${upgradedText})`;
}

/** Returns the Help Center's current admin-configured data. */
export function useResourcesConfig(): ResourcesConfigResult {
  const query = useQuery({
    queryKey: ['help-center', 'resources-config'],
    queryFn: async (): Promise<Record<string, unknown>> => {
      // `eliteaFetch` resolves `{data,status,headers}`; `unwrapBody` is the one
      // sanctioned peel (R-A6). Reading `.values` off the envelope instead is
      // the silent-empty-state defect of #132, and on this page it would look
      // exactly like the gap this change closes.
      const body = unwrapBody(await eliteaFetch<unknown>(RESOURCES_URL)) as
        | { values?: Record<string, unknown> }
        | undefined;
      return body?.values ?? {};
    },
    // These values change when an administrator edits them, which is rare, and
    // the page is opened often. Refetching on every mount would be a request per
    // visit for an answer that almost never differs.
    staleTime: 5 * 60 * 1000,
  });

  return useMemo((): ResourcesConfigResult => {
    const configValues = { ...DEFAULT_CONFIG_VALUES, ...query.data };
    return {
      configValues,
      versionLabel: resourcesVersionLabel(configValues),
      plugins: [],
    };
  }, [query.data]);
}
