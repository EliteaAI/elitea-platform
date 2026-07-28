import { getConfig } from '@/shared/config';

/**
 * `ToolCard.jsx:44,213` calls the old app's `getBasename()`
 * (`apps/elitea-ui/src/routes.js:129-131`) to build the "open in new tab"
 * URL for an attached agent/pipeline/toolkit. This app's equivalent,
 * `getAppBasename()`, lives at `src/app/providers/basename.ts` — `app/` is
 * the layer ABOVE `features/` (`app → processes → pages → widgets →
 * features → entities → shared`), so `features/agents` may not import it
 * (`no-upward-from-features`).
 *
 * Duplicated locally instead, reading the same `shared/config` (a legal
 * `features/`-importable layer) the same way `getAppBasename()` does — same
 * `import.meta.env.DEV` / `vite_base_uri` logic, same safe `''` fallback
 * when config hasn't resolved. See `app/providers/basename.ts`'s own doc
 * comment for the full rationale (both deviations from the baseline's
 * literal `DEV ? '' : VITE_BASE_URI` apply here identically).
 */
export function getAgentsBasename(): string {
  if (import.meta.env.DEV) return '';
  const result = getConfig();
  return result.status === 'ok' ? result.config.vite_base_uri : '';
}
