// §8.3 step 5 — permissions: one item per distinct permission string reached
// via the PERMISSIONS constant, PERMISSION_GROUPS, useCheckPermission call
// sites and inline permission string literals; plus the three route guards
// and the two MCP platform flags.
import path from 'node:path';
import { BASELINE, allSourceFiles, parseFile, read, rel, screenOf, src, traverse, writeOut } from './common.mjs';

const CONSTANTS = 'src/common/constants.js';
const { ast } = parseFile(path.join(BASELINE, CONSTANTS));

// 1. PERMISSIONS leaves: dotted access path -> {value, line}
const leaves = []; // {path:'chat.folders.get', value, line}
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.name !== 'PERMISSIONS') return;
    const walk = (obj, prefix) => {
      for (const prop of obj.properties) {
        if (prop.type !== 'ObjectProperty') continue;
        const key = prop.key.name || prop.key.value;
        if (prop.value.type === 'StringLiteral') {
          leaves.push({ path: [...prefix, key].join('.'), value: prop.value.value, line: prop.loc.start.line });
        } else if (prop.value.type === 'ObjectExpression') {
          walk(prop.value, [...prefix, key]);
        }
      }
    };
    walk(p.node.init, []);
  },
});

// 2. PERMISSION_GROUPS entries
const groups = [];
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.name !== 'PERMISSION_GROUPS') return;
    for (const prop of p.node.init.properties) {
      if (prop.type !== 'ObjectProperty') continue;
      const members = [];
      for (const el of prop.value.elements || []) {
        // members are PERMISSIONS.x.y.z member expressions
        const parts = [];
        let n = el;
        while (n && n.type === 'MemberExpression') {
          parts.unshift(n.property.name);
          n = n.object;
        }
        const leaf = leaves.find(l => l.path === parts.join('.'));
        if (leaf) members.push(leaf.value);
      }
      groups.push({ group: prop.key.name, members, line: prop.loc.start.line });
    }
  },
});

// 3. usage scan: PERMISSIONS.x.y member access sites, inline permission string
// literals, useCheckPermission call sites.
const usage = new Map(); // permission string -> sites[]
const addUse = (value, r, line) => {
  if (!usage.has(value)) usage.set(value, []);
  const arr = usage.get(value);
  const s = src(r, line);
  if (!arr.includes(s)) arr.push(s);
};
const leafByPath = new Map(leaves.map(l => [l.path, l]));
const known = new Set(leaves.map(l => l.value));
const PERM_RE = /^(models|configuration|configurations)\./;
const SUFFIX_RE = /\.(view|edit|create|delete|list|get|update|post|export|import|fork|patch|details|hide|unsecret|section)$/;

// global map of exported top-level string constants, so permission strings
// reached through imported/namespaced constants (e.g.
// FeedbackConstants.FEEDBACK_CREATE_PERMISSION) resolve without full import
// resolution; ambiguous names (same name, different values) are dropped.
const GLOBAL_STRING_CONSTS = new Map();
{
  const ambiguous = new Set();
  for (const f of allSourceFiles()) {
    const { ast: a } = parseFile(f);
    if (!a) continue;
    traverse(a, {
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
}

// resolve a permission-bearing argument: string literal, PERMISSIONS member,
// imported/namespaced string constant
function resolvePermArg(arg) {
  if (!arg) return null;
  if (arg.type === 'StringLiteral' && PERM_RE.test(arg.value)) return arg.value;
  if (arg.type === 'MemberExpression' && !arg.computed) {
    const parts = [];
    let n = arg;
    while (n && n.type === 'MemberExpression' && !n.computed) {
      parts.unshift(n.property.name);
      n = n.object;
    }
    if (n && n.name === 'PERMISSIONS') {
      const leaf = leafByPath.get(parts.join('.'));
      if (leaf) return leaf.value;
    }
    const v = GLOBAL_STRING_CONSTS.get(arg.property.name);
    if (v && PERM_RE.test(v)) return v;
  }
  if (arg.type === 'Identifier') {
    const v = GLOBAL_STRING_CONSTS.get(arg.name);
    if (v && PERM_RE.test(v)) return v;
  }
  return null;
}

for (const f of allSourceFiles()) {
  const r = rel(f);
  if (r === CONSTANTS) continue;
  const { ast: a } = parseFile(f);
  if (!a) continue;
  traverse(a, {
    // <perms>.includes(<permission>) — the guard pattern used instead of
    // useCheckPermission in several places (e.g. ImportWizardModal,
    // FeedbackDialog); <perms> must look like a permissions collection.
    CallExpression(p) {
      const c = p.node.callee;
      if (c.type !== 'MemberExpression' || c.property.name !== 'includes') return;
      const objName =
        c.object.type === 'Identifier'
          ? c.object.name
          : c.object.type === 'MemberExpression'
            ? c.object.property.name
            : '';
      if (!/permissions/i.test(objName)) return;
      const v = resolvePermArg(p.node.arguments[0]);
      if (v) addUse(v, r, p.node.loc.start.line);
    },
    MemberExpression(p) {
      // full chains only (avoid counting sub-objects)
      if (p.parentPath.node.type === 'MemberExpression') return;
      const parts = [];
      let n = p.node;
      while (n && n.type === 'MemberExpression' && !n.computed) {
        parts.unshift(n.property.name);
        n = n.object;
      }
      if (!n || n.name !== 'PERMISSIONS') return;
      const leaf = leafByPath.get(parts.join('.'));
      if (leaf) addUse(leaf.value, r, p.node.loc.start.line);
    },
    StringLiteral(p) {
      if (PERM_RE.test(p.node.value) && (known.has(p.node.value) || SUFFIX_RE.test(p.node.value))) {
        addUse(p.node.value, r, p.node.loc.start.line);
      }
    },
  });
}

const strings = new Map(); // value -> {sources:[], domains:Set}
for (const l of leaves) {
  if (!strings.has(l.value)) strings.set(l.value, { sources: [], sites: [] });
  strings.get(l.value).sources.push({ ref: src(CONSTANTS, l.line), path: l.path });
}
for (const [value, sites] of usage) {
  if (!strings.has(value)) strings.set(value, { sources: [], sites: [] });
  strings.get(value).sites.push(...sites);
}

const out = [];
for (const [value, rec] of [...strings.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const domains = new Set(rec.sites.map(s => screenOf(s.replace(/^apps\/elitea-ui\//, '').replace(/:\d+(-\d+)?$/, '')).domain));
  out.push({
    kind: 'permission-string',
    permission: value,
    aliases: rec.sources.map(s => s.path),
    sources: [...rec.sources.map(s => s.ref), ...rec.sites.slice(0, 5)],
    domain: domains.size === 1 ? [...domains][0] : inferDomain(value),
  });
}
function inferDomain(v) {
  if (v.startsWith('models.chat')) return 'chat';
  if (v.startsWith('models.applications.tool')) return 'toolkits';
  if (v.startsWith('models.applications.index')) return 'indexes';
  if (v.startsWith('models.applications')) return 'agents';
  if (v.startsWith('configuration.users')) return 'users';
  if (v.startsWith('configuration.secrets')) return 'secrets';
  if (v.startsWith('configuration.artifacts')) return 'artifacts';
  if (v.startsWith('configurations.')) return 'credentials';
  if (v.startsWith('configuration.litellm')) return 'credentials';
  if (v.startsWith('models.project_context')) return 'shell';
  if (v.startsWith('models.social')) return 'public';
  return 'shell';
}

// 4. groups (sidebar visibility)
for (const g of groups) {
  out.push({
    kind: 'permission-group',
    group: g.group,
    members: g.members,
    sources: [src(CONSTANTS, g.line)],
    domain: 'shell',
  });
}

// 5. three route guards
const guards = [
  ['SkillsGuard', 'src/[fsd]/app/routes/SkillsGuard.jsx', 13, 21, 'skills',
    'in the Public project every skills route redirects to the chat screen'],
  ['IntegrationGuard', 'src/[fsd]/app/routes/IntegrationGuard.jsx', 13, 20, 'credentials',
    'when project-own LLM configurations are disallowed and the project is not the public one, create-configuration routes redirect to the model-configuration settings tab'],
  ['IndexRoute', 'src/[fsd]/app/routes/IndexRoute.jsx', 11, 26, 'shell',
    'the index route shows a loading page before the user is known, sends users without a personal project to onboarding, and everyone else to chat'],
];
for (const [name, file, a, b, domain, behaviour] of guards) {
  read(file); // throws if missing
  out.push({ kind: 'guard', guard: name, sources: [src(file, a, b)], domain, behaviour });
}

// 6. two platform flags
const FLAGS = ['mcp_exposure_enabled', 'mcp_in_menu_enabled'];
for (const flag of FLAGS) {
  const sites = [];
  for (const f of allSourceFiles()) {
    const { code } = parseFile(f);
    if (!code || !code.includes(flag)) continue;
    const lines = code.split('\n');
    lines.forEach((l, i) => l.includes(flag) && sites.push(src(rel(f), i + 1)));
  }
  if (!sites.length) throw new Error(`flag ${flag} not found`);
  out.push({ kind: 'platform-flag', flag, sources: sites.slice(0, 5), domain: 'mcps' });
}

console.log(`permission strings: ${strings.size}, groups: ${groups.length}, guards: 3, flags: 2`);
writeOut('permissions.json', out);
