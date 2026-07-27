// §8.3 step 1 — routes. Seeds the already-verified §8.1 table (ids are
// spec-fixed), then CONFIRMS every pattern against the pinned baseline and
// attaches real file:line evidence. Fails loudly on any mismatch.
import { read, src, writeOut } from './common.mjs';

const ROUTES_JS = 'src/routes.js';
const PROTECTED = 'src/[fsd]/app/routes/ProtectedRoutes.jsx';
const ROUTER = 'src/[fsd]/app/routes/router.jsx';
const INDEXROUTE = 'src/[fsd]/app/routes/IndexRoute.jsx';

const routesJs = read(ROUTES_JS).split('\n');
const protectedJsx = read(PROTECTED).split('\n');
const routerJsx = read(ROUTER).split('\n');
const indexRouteJsx = read(INDEXROUTE).split('\n');

function lineOf(lines, needle, from = 0) {
  for (let i = from; i < lines.length; i++) if (lines[i].includes(needle)) return i + 1;
  return null;
}

// Spec §8.1 rows. specId kept where it differs from the schema-legal id
// (ROUTE-069b/c fail the ^[A-Z]{3,8}-\d{3}$ id rule; renumbered 072/073 —
// reported, not silently fixed).
// [id, pattern, defKey, target, note, specId?]
const ROWS = [
  ['ROUTE-001', '/auth-callback', 'AuthCallbackPage', 'AuthCallbackPage',
    'eager (not lazy), no sidebar and no guard; reads ?auth_state=, posts the auth result to the opener window and closes itself after 300 ms'],
  ['ROUTE-002', '/*', null, 'AppLayout',
    'application shell wrapper for every non-auth-callback path; the old AppLayout has no Outlet (do not port this shape)'],
  ['ROUTE-003', '/', null, 'IndexRoute',
    'no user id yet: loading page; user without personal project: redirect to /onboarding; otherwise redirect to /chat'],
  ['ROUTE-004', '/onboarding', 'Onboarding', 'Onboarding', 'sidebar hidden while the user has no personal project'],
  ['ROUTE-005', '/help-center', 'HelpCenter', 'Resources', ''],
  ['ROUTE-006', '/agents-hub', 'AgentHub', 'AgentHub', ''],
  ['ROUTE-007', '/chat', 'Chat', 'ChatWrapper', 'requires the chat-folders read permission; otherwise the user lands on /onboarding'],
  ['ROUTE-008', '/chat/:conversationId', 'ChatConversation', 'ChatWrapper', 'requires the chat-folders read permission; otherwise the user lands on /onboarding'],
  ['ROUTE-009', '/agents', 'Applications', 'index redirect', 'index redirects to the first Applications tab, preserving query string and history state'],
  ['ROUTE-010', '/agents/create', 'CreateApplication', 'CreateApplication', 'navigation is blocked while the form is dirty'],
  ['ROUTE-011', '/agents/:tab', 'ApplicationsWithTab', 'Applications', ''],
  ['ROUTE-012', '/agents/:tab/:agentId', 'ApplicationsDetail', 'EditApplication', 'navigation is blocked when the viewer owns the agent and the form is dirty'],
  ['ROUTE-013', '/skills', 'Skills', 'index redirect', 'guarded: hidden entirely in the Public project (redirects to /chat); index redirects to the first Skills tab'],
  ['ROUTE-014', '/skills/create', 'CreateSkill', 'CreateSkill', 'guarded: hidden entirely in the Public project (redirects to /chat)'],
  ['ROUTE-015', '/skills/:tab', 'SkillsWithTab', 'Skills', 'guarded: hidden entirely in the Public project (redirects to /chat)'],
  ['ROUTE-016', '/skills/:tab/:skillId', 'SkillsDetail', 'EditSkill', 'guarded: hidden entirely in the Public project (redirects to /chat)'],
  ['ROUTE-017', '/pipelines', 'Pipelines', 'index redirect', 'index redirects to the first Applications tab, preserving query string and history state'],
  ['ROUTE-018', '/pipelines/create', 'CreatePipeline', 'CreatePipeline', 'navigation is blocked while the form is dirty'],
  ['ROUTE-019', '/pipelines/:tab', 'PipelinesWithTab', 'Pipelines', ''],
  ['ROUTE-020', '/pipelines/:tab/:agentId', 'PipelineDetail', 'EditPipeline', 'navigation is blocked while the form is dirty'],
  ['ROUTE-021', '/credentials', 'Credentials', 'index redirect', 'index redirects to the first Credentials tab, preserving query string and history state'],
  ['ROUTE-022', '/credentials/:tab', 'CredentialsWithTab', 'Credentials', ''],
  ['ROUTE-023', '/credentials/create-credential', 'CreateCredentialFromMain', 'CreateCredentialFromMain', 'navigation is blocked while the form is dirty'],
  ['ROUTE-024', '/credentials/create-credential/:credentialType', 'CreateCredentialTypeFromMain', 'CreateCredentialFromMain', 'navigation is blocked while the form is dirty'],
  ['ROUTE-025', '/credentials/:tab/:credential_uid', 'EditCredentialFromMain', 'EditCredentialFromMain', 'navigation is blocked while the form is dirty'],
  ['ROUTE-026', '/toolkits', 'Toolkits', 'index redirect', 'index redirects to the first Toolkits tab, preserving query string and history state'],
  ['ROUTE-027', '/toolkits/create', 'CreateToolkit', 'CreateToolkit', ''],
  ['ROUTE-028', '/toolkits/create/:toolkitType', 'CreateToolkitType', 'CreateToolkit', 'navigation is blocked while the form is dirty'],
  ['ROUTE-029', '/toolkits/:tab', 'ToolkitsWithTab', 'Toolkits', ''],
  ['ROUTE-030', '/toolkits/:tab/:toolkitId', 'ToolkitDetail', 'EditToolkit', 'navigation is blocked while anything on the page is dirty'],
  ['ROUTE-031', '/mcps', 'MCPs', 'index redirect', 'menu entry hidden unless the MCP platform flags are enabled; index redirects to the first Toolkits tab'],
  ['ROUTE-032', '/mcps/create', 'CreateMCP', 'CreateToolkit (MCP mode)', ''],
  ['ROUTE-033', '/mcps/create/:mcpType', 'CreateMCPType', 'CreateToolkit (MCP mode)', ''],
  ['ROUTE-034', '/mcps/:tab', 'MCPsWithTab', 'Toolkits (MCP mode)', ''],
  ['ROUTE-035', '/mcps/:tab/:mcpId', 'MCPDetail', 'EditToolkit (MCP mode)', ''],
  ['ROUTE-036', '/apps', 'Apps', 'Apps', ''],
  ['ROUTE-037', '/apps/create', 'CreateApp', 'CreateToolkit (application mode)', ''],
  ['ROUTE-038', '/apps/create/:appType', 'CreateAppType', 'CreateToolkit (application mode)', ''],
  ['ROUTE-039', '/apps/:tab', 'AppsWithTab', 'Apps', 'covers /apps/applications and /apps/catalog'],
  ['ROUTE-040', '/apps/:tab/:appId', 'AppDetail', 'AppDetail', ''],
  ['ROUTE-041', '/user-public/:tab', 'UserPublicWithTab', 'UserPublic', ''],
  ['ROUTE-042', '/user-public/agents/:agentId', 'UserPublicApplicationDetail', 'EditApplication', 'navigation is blocked while the form is dirty'],
  ['ROUTE-043', '/user-public/pipelines/:agentId', 'UserPublicPipelineDetail', 'EditPipeline', ''],
  ['ROUTE-044', '/user-public/toolkits/:toolkitId', 'UserPublicToolkitDetail', 'EditToolkit', ''],
  ['ROUTE-045', '/user-public/mcps/:mcpId', 'UserPublicMCPDetail', 'EditToolkit (MCP mode)', ''],
  ['ROUTE-046', '/user-public/apps/:appId', 'UserPublicAppDetail', 'AppDetail', ''],
  ['ROUTE-047', '/mode-switch', 'ModeSwitch', 'ModeSwitch', ''],
  ['ROUTE-048', '/artifacts', 'Artifacts', 'Artifacts', 'requires the artifacts view permission'],
  ['ROUTE-049', '/artifacts/create-bucket', 'CreateBucket', 'CreateBucket', ''],
  ['ROUTE-050', '/mcp-auth-callback', 'McpAuthPage', 'McpAuthPage', ''],
  ['ROUTE-051', '/settings', 'Settings', 'Settings layout', 'the only nested layout: settings drawer plus an outlet for the active tab'],
  ['ROUTE-052', '/settings (index)', null, 'redirect to model-configuration', 'index redirect, replace-style'],
  ['ROUTE-053', '/settings/model-configuration', null, 'AIConfiguration', ''],
  ['ROUTE-054', '/settings/environment', null, 'EnvironmentSettings', ''],
  ['ROUTE-055', '/settings/project-params', null, 'ProjectContextSettings', ''],
  ['ROUTE-056', '/settings/prompts', null, 'ServicePromptsPage', ''],
  ['ROUTE-057', '/settings/tokens', null, 'TokensSettings', ''],
  ['ROUTE-058', '/settings/secrets', null, 'Secrets', ''],
  ['ROUTE-059', '/settings/users', null, 'Users', ''],
  ['ROUTE-060', '/settings/analytics', null, 'AnalyticsContainer', ''],
  ['ROUTE-061', '/settings/personalization', null, 'UserSettings', ''],
  ['ROUTE-062', '/settings/notifications', null, 'NotificationCenter', ''],
  ['ROUTE-063', '/settings/create-configuration', null, 'CreateCredentialFromMain (configuration mode)',
    'guarded: hidden when project-own LLMs are disallowed on non-public projects; titled "New Configuration", category selector hidden'],
  ['ROUTE-064', '/settings/create-configuration/:credentialType', null, 'CreateCredentialFromMain (configuration mode)',
    'guarded: hidden when project-own LLMs are disallowed on non-public projects'],
  ['ROUTE-065', '/settings/edit-configuration/:credential_uid', null, 'EditCredentialFromMain (configuration mode)',
    'titled "Configuration"; the mounted param is :credential_uid although the route-definition constant declares :uid — the mounted route wins'],
  ['ROUTE-066', '/settings/create-personal-token', null, 'CreatePersonalToken', 'navigation is blocked while the form is dirty'],
  ['ROUTE-067', '/agents/:tab/:agentId/:version', null, 'EditApplication (version child)', 'empty child element: the parent renders and reads the version parameter'],
  ['ROUTE-068', '/skills/:tab/:skillId/:version', null, 'EditSkill (version child)', 'empty child element: the parent renders and reads the version parameter'],
  ['ROUTE-069', '/pipelines/:tab/:agentId/:version', null, 'EditPipeline (version child)', 'empty child element: the parent renders and reads the version parameter'],
  ['ROUTE-072', '/user-public/agents/:agentId/:version', null, 'EditApplication (version child)', 'empty child element: the parent renders and reads the version parameter', 'ROUTE-069b'],
  ['ROUTE-073', '/user-public/pipelines/:agentId/:version', null, 'EditPipeline (version child)', 'empty child element: the parent renders and reads the version parameter', 'ROUTE-069c'],
  ['ROUTE-070', '/:projectId/*', null, 'ProjectSwitcher',
    'matches every otherwise-unmatched path including single-segment ones; sets the active project then hard-reloads at the same path with the project segment stripped; this is the shape of every share link and must keep the lowest match priority and the full-page reload'],
  ['ROUTE-071', '*', null, 'Page404', 'only reachable for paths the project-switcher catch-all declines'],
];

// D4 anomalies — must items, bug-for-bug (decision record D4).
const ANOMALIES = [
  ['ROUTE-074', '/artifacts/edit-bucket',
    'declared in the route table but never mounted; two segments, so the project-switcher catch-all swallows it and hard-reloads against a project named "artifacts"'],
  ['ROUTE-075', '/user-public',
    'declared in the route table but never mounted; the project-switcher catch-all swallows it and treats "user-public" as a project id'],
  ['ROUTE-076', '/settings/:tab',
    'declared in the route table, but the settings children are mounted explicitly, so an unknown settings tab renders the settings layout with an empty content area — no 404 and no redirect'],
];

const items = [];
const problems = [];

for (const [id, pattern, defKey, target, note, specId] of ROWS) {
  const sources = [];
  if (defKey) {
    const defLine = lineOf(routesJs, `'${pattern}'`);
    if (!defLine) problems.push(`${id}: pattern ${pattern} not found in ${ROUTES_JS}`);
    else sources.push(src(ROUTES_JS, defLine));
    const mountLine = lineOf(protectedJsx, `RouteDefinitions.${defKey}`, 155);
    if (id === 'ROUTE-001') {
      const l = lineOf(routerJsx, 'RouteDefinitions.AuthCallbackPage');
      if (!l) problems.push(`${id}: not mounted in router.jsx`);
      else sources.push(src(ROUTER, l));
    } else if (!mountLine) {
      problems.push(`${id}: RouteDefinitions.${defKey} not mounted in ProtectedRoutes.jsx`);
    } else {
      sources.push(src(PROTECTED, mountLine));
    }
  } else if (pattern === '/*') {
    sources.push(src(ROUTER, lineOf(routerJsx, `path="/*"`)));
  } else if (pattern === '/') {
    sources.push(src(PROTECTED, lineOf(protectedJsx, '<IndexRoute />') - 2, lineOf(protectedJsx, '<IndexRoute />')));
    sources.push(src(INDEXROUTE, 11, 26));
  } else if (id === 'ROUTE-052') {
    const l = lineOf(protectedJsx, '"model-configuration"');
    sources.push(src(PROTECTED, l - 4, l + 2));
  } else if (pattern.startsWith('/settings/')) {
    const child = pattern.slice('/settings/'.length).replace('/:credentialType', '').replace('/:credential_uid', '');
    const l =
      lineOf(protectedJsx, `path="${child}"`) ||
      lineOf(protectedJsx, `path={'${child}${pattern.includes(':credentialType') ? '/:credentialType' : pattern.includes(':credential_uid') ? '/:credential_uid' : ''}'}`);
    if (!l) problems.push(`${id}: settings child ${pattern} not mounted`);
    else sources.push(src(PROTECTED, l));
    sources.push(src(PROTECTED, lineOf(protectedJsx, 'RouteDefinitions.Settings', 155)));
  } else if (pattern.endsWith('/:version')) {
    const parent = pattern.replace('/:version', '');
    const parentRow = ROWS.find(r => r[1] === parent);
    const defLine = lineOf(routesJs, `'${parent}'`);
    sources.push(src(ROUTES_JS, defLine));
    const vs = lineOf(protectedJsx, `path.endsWith('/:agentId')`);
    sources.push(src(PROTECTED, vs, vs + 5));
    if (!parentRow) problems.push(`${id}: version child without parent row`);
    if (!(parent.endsWith('/:agentId') || parent.endsWith('/:skillId')))
      problems.push(`${id}: version-append rule does not apply to ${parent}`);
  } else if (pattern === '/:projectId/*') {
    sources.push(src(PROTECTED, lineOf(protectedJsx, '"/:projectId/*"')));
    sources.push(src('src/pages/ProjectSwitcher.jsx', 1));
  } else if (pattern === '*') {
    const l = lineOf(protectedJsx, 'path="*"');
    sources.push(src(PROTECTED, l, l + 3));
  } else {
    problems.push(`${id}: no verification strategy for ${pattern}`);
  }
  items.push({ id, specId: specId || id, pattern, target, note, sources, anomaly: false });
}

// verify the version-append rule really matches exactly the 5 spec children
const versionParents = ROWS.filter(
  r => r[2] && (r[1].endsWith('/:agentId') || r[1].endsWith('/:skillId')),
).map(r => r[1]);
const versionChildren = ROWS.filter(r => r[1].endsWith('/:version')).map(r => r[1].replace('/:version', ''));
for (const p of versionParents)
  if (!versionChildren.includes(p)) problems.push(`version child missing for mounted parent ${p}`);
for (const c of versionChildren)
  if (!versionParents.includes(c)) problems.push(`version child ${c} has no mounted parent`);

for (const [id, pattern, note] of ANOMALIES) {
  const sources = [];
  const defLine = lineOf(routesJs, `'${pattern}'`);
  if (!defLine) problems.push(`${id}: anomaly pattern ${pattern} not declared in routes.js`);
  else sources.push(src(ROUTES_JS, defLine));
  // evidence that it is NOT mounted: the catch-all / settings mount lines
  if (pattern === '/settings/:tab') sources.push(src(PROTECTED, lineOf(protectedJsx, 'RouteDefinitions.Settings', 155)));
  else sources.push(src(PROTECTED, lineOf(protectedJsx, '"/:projectId/*"')));
  items.push({ id, specId: id, pattern, target: 'latent anomaly (reproduce bug-for-bug, decision D4)', note, sources, anomaly: true });
}

if (problems.length) {
  console.error('ROUTE VERIFICATION PROBLEMS:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
writeOut('routes.json', items);
