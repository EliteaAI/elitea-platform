/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/helpers/toolkits.helpers.js:8-33`
 * (`canonToolkitKey`/`isToolkitTypeBlocked`/`getToolkitTypeLabel`) — pure
 * functions, no hooks. Duplicated locally rather than imported from
 * `features/toolkits` (which does not exist as a slice this sub-unit may
 * import from either way — `no-sideways-features`, absolute, see this
 * batch's brief).
 *
 * **Real, disclosed gap:** the baseline's `isToolkitTypeBlocked` reads a
 * module-level `BLOCKED_TOOLKITS` constant (`common/constants.js:19`,
 * `getEnvVar('blocked_toolkits', [])`) — an org-guardrails blocklist
 * delivered via runtime config. `shared/config`'s schema (`shared/config/
 * schema.ts`) has no `blocked_toolkits` key (grepped directly, zero hits),
 * so this app has no way to read that list yet. `isToolkitTypeBlocked`
 * below takes the blocklist as a parameter instead of reading a module-level
 * constant — the comparison LOGIC is ported faithfully (verbatim
 * `canonToolkitKey` normalisation), only the list's SOURCE moves to the
 * caller, same shape of deviation `entities/toolkit`'s own promoted files
 * use for config gaps. `ToolCard.jsx`'s caller (a page/widget layer) can
 * wire a real source once `shared/config` grows the key.
 */

/** Separator/case-insensitive key, matching the SDK/admin guardrail normalization so 'GitHub', 'github' and 'git_hub' all collapse to the same comparison key. */
function canonToolkitKey(value: string | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** True when a toolkit `type` is on the org guardrails blocklist. */
export function isToolkitTypeBlocked(type: string | undefined, blockedToolkitTypes: readonly string[] | undefined): boolean {
  const key = canonToolkitKey(type);
  return !!key && (blockedToolkitTypes ?? []).some((blocked) => canonToolkitKey(blocked) === key);
}

/**
 * Display label for a toolkit TYPE (e.g. 'github' -> 'Github'). Blocking is
 * done by type, so the blocked-toolkit warning must name the type — never
 * the user's instance/configuration name (every toolkit of this type is
 * blocked regardless).
 */
export function getToolkitTypeLabel(type: string | undefined): string {
  const t = typeof type === 'string' ? type.trim() : '';
  if (!t) return 'Toolkit';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
