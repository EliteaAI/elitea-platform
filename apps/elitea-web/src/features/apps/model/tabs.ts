import { AppsTabs } from '@/shared/lib/tabs';

export type AppsTab = (typeof AppsTabs)[number];

/**
 * `Apps.jsx:20-22` — a legacy tab-slug alias kept for old bookmarked/shared
 * URLs. Preserved byte-for-byte, including the baseline's own surprising
 * mapping (`all` resolves to the CATALOG tab, not "applications" despite
 * the name — N4: reproduce, don't second-guess).
 */
const LEGACY_APPS_TABS: Readonly<Record<string, AppsTab>> = {
  all: AppsTabs[1],
};

/**
 * Keyed by the closed `AppsTab` union (not a generic `string`) so every
 * lookup with a real `AppsTab` value is statically known to succeed — no
 * `noUncheckedIndexedAccess` fallback needed for those call sites. Values
 * are still built generically from `AppsTabs` (not hand-duplicated) so this
 * cannot drift out of sync with the array it derives from.
 */
const APP_TAB_INDEX_BY_KEY: Readonly<Record<AppsTab, number>> = AppsTabs.reduce(
  (acc, tab, index) => ({ ...acc, [tab]: index }),
  {} as Record<AppsTab, number>,
);

function isAppsTab(tab: string): tab is AppsTab {
  return Object.hasOwn(APP_TAB_INDEX_BY_KEY, tab);
}

/** `Apps.jsx:41-42`. */
export function defaultAppsTab(hasApplications: boolean): AppsTab {
  return hasApplications ? AppsTabs[0] : AppsTabs[1];
}

/**
 * Ported from `Apps.jsx:54-60`'s `normalizedTab` memo — resolves the raw
 * `:tab` route param (absent for bare `/apps`, per ROUTE-036) to a real
 * `AppsTab`: a legacy alias first, an unrecognised/absent value falls back
 * to the applications-vs-catalog default, otherwise the param is already
 * valid and passes through unchanged.
 */
export function normalizeAppsTab(tab: string | undefined, hasApplications: boolean): AppsTab {
  if (tab !== undefined && LEGACY_APPS_TABS[tab] !== undefined) {
    return LEGACY_APPS_TABS[tab];
  }
  if (tab === undefined || !isAppsTab(tab)) {
    return defaultAppsTab(hasApplications);
  }
  return tab;
}

/** `Apps.jsx:65`. */
export function appsTabIndex(tab: AppsTab): number {
  return APP_TAB_INDEX_BY_KEY[tab];
}

/** `Apps.jsx:79`'s `AppsTabs[nextTabIndex] || AppsTabs[0]` — the inverse of `appsTabIndex`, for a `BaseTabs onChange` handler. Out-of-range falls back to the first (applications) tab. */
export function appsTabByIndex(index: number): AppsTab {
  return AppsTabs[index] ?? AppsTabs[0];
}

/** `Apps.jsx:66` — the "Applications" tab is the one with a right-panel view toggle. */
export function isApplicationsTab(tab: AppsTab): boolean {
  return appsTabIndex(tab) === APP_TAB_INDEX_BY_KEY[AppsTabs[0]];
}

/**
 * Ported from `Apps.jsx:44-52`'s `getSearchForAppsTab` — operates on the
 * already-parsed search OBJECT (TanStack Router's `validateSearch` output)
 * rather than a raw `URLSearchParams`/query string, since PARAM-022/023's
 * `view` schema (`src/routes/-search/params.ts`) already owns string
 * parsing. The `view` toggle only applies to the Applications tab's
 * card/table switch (`ViewToggle`); switching to the Catalog tab drops any
 * `view` value already in the URL, same as the baseline.
 *
 * Returns the SAME object reference when there is nothing to strip
 * (deliberately, not just an equal-by-value copy) — `pages/apps/Apps.tsx`
 * relies on reference equality to decide whether a redirect is needed at
 * all, the same way the baseline's `normalizedSearch === location.search`
 * check does with a real, single canonical string.
 */
export function searchForAppsTab<T extends { view?: string }>(tab: AppsTab, search: T): T {
  if (tab !== AppsTabs[1]) return search;
  if (search.view === undefined) return search;
  const { view: _view, ...rest } = search;
  return rest as T;
}
