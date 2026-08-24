/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/helpers/toolkits.helpers.js:8-33`
 * (`canonToolkitKey`/`isToolkitTypeBlocked`/`getToolkitTypeLabel`) — pure
 * functions, no hooks. Duplicated locally rather than imported from
 * `features/toolkits` (which does not exist as a slice this sub-unit may
 * import from either way — `no-sideways-features`, absolute, see this
 * batch's brief).
 *
 * **The gap this documented is CLOSED.** It read: the baseline's
 * `isToolkitTypeBlocked` reads a module-level `BLOCKED_TOOLKITS` constant
 * (`common/constants.js:19`, `getEnvVar('blocked_toolkits', [])`) delivered via
 * runtime config, `shared/config` has no such key, so the list's SOURCE moves
 * to the caller until one exists.
 *
 * No caller ever passed it. `isBlockedToolkit` was therefore computed on every
 * ToolCard render and was structurally always `false`, so the "blocked by your
 * organization" banner could not appear on any screen — the parameter was
 * supplied only by tests.
 *
 * The source exists now, and it is better than the baseline's: the admin
 * Configuration page's Guardrails section writes `blocked_toolkits` into
 * `centry.platform_config`, and `GET /elitea_core/platform_settings/prompt_lib`
 * publishes it, so the list is per-deployment configuration rather than a build
 * -time environment variable. `../api/useBlockedToolkitTypes` reads it and
 * `AgentToolRow` passes it. Taking the list as a PARAMETER is kept — it is the
 * better shape regardless, and it is what makes this function testable.
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
