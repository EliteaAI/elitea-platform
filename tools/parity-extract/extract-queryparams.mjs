// §8.3 step 2 — query params: AST scan of useSearchParams /
// searchParams.get( / URLSearchParams call sites; one item per distinct key
// per route group. Request-building URLSearchParams instances (API layer,
// object-literal seeded builders piped into request URLs) are excluded —
// those are endpoint concerns (step 3), not routeable URL state.
import path from 'node:path';
import { BASELINE, allSourceFiles, parseFile, rel, screenOf, src, traverse, writeOut } from './common.mjs';

// Resolve the canonical SearchParams constant map (constants.js:279+) and a
// global map of exported top-level string constants (handles imported names
// like AUTH_STATE_PARAM without full import resolution; names that collide
// with different values are dropped as ambiguous).
const SEARCH_PARAMS = new Map();
{
  const { ast } = parseFile(path.join(BASELINE, 'src/common/constants.js'));
  traverse(ast, {
    VariableDeclarator(p) {
      if (p.node.id.name !== 'SearchParams') return;
      for (const prop of p.node.init.properties)
        if (prop.type === 'ObjectProperty' && prop.value.type === 'StringLiteral')
          SEARCH_PARAMS.set(prop.key.name || prop.key.value, prop.value.value);
    },
  });
}
const GLOBAL_STRING_CONSTS = new Map();
const ambiguous = new Set();
for (const f of allSourceFiles()) {
  const { ast } = parseFile(f);
  if (!ast) continue;
  traverse(ast, {
    VariableDeclarator(p) {
      if (p.parentPath.parentPath.node.type !== 'ExportNamedDeclaration') return;
      if (p.node.id.type !== 'Identifier' || !p.node.init || p.node.init.type !== 'StringLiteral') return;
      const { name } = p.node.id;
      if (GLOBAL_STRING_CONSTS.has(name) && GLOBAL_STRING_CONSTS.get(name) !== p.node.init.value)
        ambiguous.add(name);
      GLOBAL_STRING_CONSTS.set(name, p.node.init.value);
    },
  });
}
for (const name of ambiguous) GLOBAL_STRING_CONSTS.delete(name);

function resolveKeyArg(arg) {
  if (!arg) return null;
  if (arg.type === 'StringLiteral') return arg.value;
  if (arg.type === 'MemberExpression' && arg.object.name === 'SearchParams' && !arg.computed)
    return SEARCH_PARAMS.get(arg.property.name) || null;
  // namespaced constants, e.g. AuthConstants.AUTH_STATE_PARAM
  if (arg.type === 'MemberExpression' && !arg.computed && GLOBAL_STRING_CONSTS.has(arg.property.name))
    return GLOBAL_STRING_CONSTS.get(arg.property.name);
  if (arg.type === 'Identifier') return GLOBAL_STRING_CONSTS.get(arg.name) || null;
  return null;
}

// route-group attribution: screen -> representative route pattern(s) (spec §8.1)
const SCREEN_ROUTES = {
  chat: '/chat, /chat/:conversationId',
  'chat-conversation-list': '/chat, /chat/:conversationId',
  agents: '/agents/:tab, /agents/:tab/:agentId',
  skills: '/skills/:tab, /skills/:tab/:skillId',
  pipelines: '/pipelines/:tab, /pipelines/:tab/:agentId',
  credentials: '/credentials/:tab, /credentials/:tab/:credential_uid',
  toolkits: '/toolkits/:tab, /toolkits/:tab/:toolkitId',
  indexes: '/toolkits/:tab/:toolkitId (indexes panel)',
  apps: '/apps/:tab, /apps/:tab/:appId',
  mcps: '/mcps/:tab, /mcps/:tab/:mcpId',
  'mcp-auth': '/mcp-auth-callback',
  artifacts: '/artifacts',
  'settings-secrets': '/settings/secrets',
  'settings-users': '/settings/users',
  'settings-tokens': '/settings/tokens',
  'settings-model-configuration': '/settings/model-configuration',
  settings: '/settings/*',
  'settings-personalization': '/settings/personalization',
  notifications: '/settings/notifications',
  analytics: '/settings/analytics',
  'user-public': '/user-public/:tab',
  onboarding: '/onboarding',
  'help-center': '/help-center',
  'agents-hub': '/agents-hub',
  'mode-switch': '/mode-switch',
  'auth-callback': '/auth-callback',
  'run-history': '/agents/:tab/:agentId, /pipelines/:tab/:agentId (History tab)',
  'import-wizard': '/agents/:tab, /pipelines/:tab (import wizard)',
  sidebar: 'any (shell)',
  'shell-widgets': 'any (shell)',
  'project-switcher': '/:projectId/*',
};

const found = new Map(); // `${screen}::${key}` -> {key, screen, domain, routes, ops:Set, sites:[]}

function record(key, r, line, op) {
  if (!key || typeof key !== 'string') return;
  // skip request-building keys recorded in the API layer
  if (r.startsWith('src/api/') || /\/api\//.test(r)) return;
  const { screen, domain } = screenOf(r);
  const id = `${screen}::${key}`;
  if (!found.has(id))
    found.set(id, { key, screen, domain, routes: SCREEN_ROUTES[screen] || 'any', ops: new Set(), sites: [] });
  const rec = found.get(id);
  rec.ops.add(op);
  const s = src(r, line);
  if (!rec.sites.includes(s)) rec.sites.push(s);
}

for (const f of allSourceFiles()) {
  const r = rel(f);
  const { ast, code } = parseFile(f);
  if (!ast) continue;

  // find identifiers bound to route search params:
  //   const [searchParams, setSearchParams] = useSearchParams()
  //   const params = new URLSearchParams(location.search | window.location.search | search | *.search)
  const spNames = new Set();
  const setterNames = new Set();
  traverse(ast, {
    VariableDeclarator(p) {
      const init = p.node.init;
      if (!init) return;
      if (init.type === 'CallExpression' && init.callee.name === 'useSearchParams' && p.node.id.type === 'ArrayPattern') {
        const [g, s] = p.node.id.elements;
        if (g && g.type === 'Identifier') spNames.add(g.name);
        if (s && s.type === 'Identifier') setterNames.add(s.name);
      }
      if (init.type === 'NewExpression' && init.callee.name === 'URLSearchParams') {
        const arg = init.arguments[0];
        const isRouteState =
          arg &&
          ((arg.type === 'MemberExpression' && arg.property.name === 'search') ||
            (arg.type === 'Identifier' && /search/i.test(arg.name)));
        if (isRouteState && p.node.id.type === 'Identifier') spNames.add(p.node.id.name);
      }
    },
  });

  traverse(ast, {
    // share-link builders: SearchParams.X interpolated into a template
    // literal is a URL WRITE — a query-param contract even when no in-app
    // reader exists (e.g. generateBucketShareUrl writes shared_bucket).
    TemplateLiteral(p) {
      for (const e of p.node.expressions) {
        if (e.type === 'MemberExpression' && e.object.name === 'SearchParams' && !e.computed) {
          const v = SEARCH_PARAMS.get(e.property.name);
          if (v) record(v, r, e.loc.start.line, 'link');
        }
      }
    },
    CallExpression(p) {
      const callee = p.node.callee;
      const arg = p.node.arguments[0];
      // search-string sniffing: `search.includes(SearchParams.X)` — reads
      // the raw location.search for a key (e.g. useBackPath toolkit_type)
      if (callee.type === 'MemberExpression' && callee.property.name === 'includes') {
        const objName =
          callee.object.type === 'Identifier'
            ? callee.object.name
            : callee.object.type === 'MemberExpression'
              ? callee.object.property.name
              : '';
        if (/search/i.test(objName)) {
          const k = resolveKeyArg(arg);
          if (k) record(k, r, p.node.loc.start.line, 'sniff');
          return;
        }
      }
      // wrapper hooks: useSearchParamValue('ViewMode') takes the SearchParams
      // KEY NAME; other use*SearchParam*/use*FromUrl hooks take the raw key.
      if (callee.type === 'Identifier' && /SearchParam|FromUrl/i.test(callee.name)) {
        if (callee.name === 'useSearchParamValue' && arg && arg.type === 'StringLiteral') {
          const v = SEARCH_PARAMS.get(arg.value);
          if (v) record(v, r, p.node.loc.start.line, 'hook');
          return;
        }
        const k = resolveKeyArg(arg);
        if (k) record(k, r, p.node.loc.start.line, 'hook');
        return;
      }
      if (callee.type !== 'MemberExpression') return;
      const op = callee.property.name;
      // searchParams.get('k') / has / set / delete — on a tracked binding, or
      // any direct `<x>.searchParams.get(...)` chain off a URL/location.
      const objIsTracked =
        (callee.object.type === 'Identifier' && spNames.has(callee.object.name)) ||
        (callee.object.type === 'MemberExpression' && callee.object.property.name === 'searchParams');
      if (!objIsTracked) return;
      if (!['get', 'getAll', 'has', 'set', 'delete'].includes(op)) return;
      const key = resolveKeyArg(arg);
      if (key) record(key, r, p.node.loc.start.line, op);
    },
    // setSearchParams({ k: v }) / setSearchParams(prev => {...prev, k})
    Identifier(p) {
      if (!setterNames.has(p.node.name)) return;
      const parent = p.parentPath.node;
      if (parent.type !== 'CallExpression' || parent.callee !== p.node) return;
      const arg = parent.arguments[0];
      if (arg && arg.type === 'ObjectExpression')
        for (const prop of arg.properties) {
          if (prop.type !== 'ObjectProperty') continue;
          const key = prop.computed
            ? resolveKeyArg(prop.key)
            : prop.key.name || prop.key.value;
          if (key) record(key, r, prop.loc.start.line, 'set');
        }
    },
  });
}

const out = [...found.values()]
  .map(x => ({ ...x, ops: [...x.ops].sort() }))
  .sort((a, b) => a.screen.localeCompare(b.screen) || a.key.localeCompare(b.key));

// §8.2 floor check — the 10 documented params must all be found by the scan
const SPEC_QP = [
  ['QP-001', 'createSecret'], ['QP-002', 'inviteUsers'], ['QP-003', 'create'],
  ['QP-004', 'agent_id'], ['QP-005', 'tour'], ['QP-006', 'history_run_id'],
  ['QP-006', 'destTab'], ['QP-007', 'edited_participant_id'], ['QP-008', 'index_name'],
  ['QP-009', 'file'], ['QP-009', 'folder'], ['QP-009', 'bucket'], ['QP-010', 'auth_state'],
];
const keys = new Set(out.map(x => x.key));
const missing = SPEC_QP.filter(([, k]) => !keys.has(k));
if (missing.length) {
  console.error('SPEC §8.2 KEYS NOT FOUND BY SCAN (report, do not drop):', JSON.stringify(missing));
}
// tag spec ids onto matching rows
for (const row of out) {
  row.specIds = SPEC_QP.filter(([, k]) => k === row.key).map(([id]) => id);
}
console.log(`distinct (key × route-group) items: ${out.length}; distinct keys: ${keys.size}`);
writeOut('queryparams.json', out);
