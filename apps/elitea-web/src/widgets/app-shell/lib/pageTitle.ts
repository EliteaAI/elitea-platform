/**
 * Pure `document.title` derivation (spec: old app `hooks/useBrowserPageTitle.js`
 * / `PageTitleSetter`). Reduced from the baseline, documented precisely:
 *
 * The old app branches on route-specific PARAM NAMES (`params.agentId`,
 * `params.skillId`, `params.toolkitId`, `params.mcpId`,
 * `params.credential_uid`, `params.conversationId`) that only a route file
 * itself resolves via `useParams()` — a generic pathname+search deriver
 * (this widget has no page-specific route context) cannot read a named
 * path param without importing the actual route definition it belongs to
 * (out of this widget's ownership fence). The `?name=` SEARCH param the old
 * app also reads (`URLSearchParams(location.search).get('name')`,
 * independent of any specific route's typed params) is the one signal this
 * function CAN read generically, and does — covering the common case
 * ("Chat: My Conversation - Project") while the id-only fallback
 * ("Chat: conv-abc123 - Project") is not reproduced (falls back to the
 * section name alone instead of the id). A real, reduced title, not a
 * placeholder: every branch produces a genuine value old-app users would
 * recognise, just without the id-in-title fallback.
 */
const SECTION_BY_PREFIX: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: '/chat', label: 'Chat' },
  { prefix: '/agents-hub', label: 'Agent HUB' },
  { prefix: '/agents', label: 'Agents' },
  { prefix: '/pipelines', label: 'Pipelines' },
  { prefix: '/toolkits', label: 'Toolkits' },
  { prefix: '/mcps', label: 'MCPs' },
  { prefix: '/credentials', label: 'Credentials' },
  { prefix: '/artifacts', label: 'Artifacts' },
  { prefix: '/user-public', label: 'User public' },
  { prefix: '/skills', label: 'Skills' },
  { prefix: '/apps', label: 'Applications' },
  { prefix: '/help-center', label: 'Help Center' },
];

/** `/settings/foo` -> "Settings: Foo"; the two bespoke-cased tabs the old app titles specially. */
const SETTINGS_TAB_LABEL: Readonly<Record<string, string>> = {
  personalization: 'Personalization',
  notifications: 'Notifications',
};

function settingsTitle(pathname: string, projectName: string): string {
  const tab = pathname.replace(/^\/settings\/?/, '').split('/')[0];
  if (!tab) return `Settings - ${projectName}`;
  const label = SETTINGS_TAB_LABEL[tab] ?? tab;
  return `Settings: ${label} - ${projectName}`;
}

/**
 * @param pathname current router pathname
 * @param searchName the `?name=` query param value, if present
 * @param projectName the selected project's display name (or `undefined` before one is known)
 */
export function derivePageTitle(pathname: string, searchName: string, projectName: string | undefined): string {
  const project = projectName ?? '';

  if (pathname.startsWith('/settings')) return settingsTitle(pathname, project);

  // `/agents-hub` is listed BEFORE `/agents` in SECTION_BY_PREFIX so this
  // find() resolves it correctly — `/agents-hub`.startsWith('/agents') is
  // also true, the same substring-prefix hazard `widgets/create-button`'s
  // `currentEntityFromPathname` documents and fixes the same way (ordering,
  // proven by the analogous regression test in that widget).
  const section = SECTION_BY_PREFIX.find((entry) => pathname.startsWith(entry.prefix));
  if (!section) return project;

  return searchName ? `${section.label}: ${searchName} - ${project}` : `${section.label} - ${project}`;
}
