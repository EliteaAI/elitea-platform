// Shell anchors (§8.6 shell row + waiver W-007): mechanical extraction of
//   - the sidebar navigation entries and their 3 permission-filtered groups
//     (SidebarBody.jsx sections array),
//   - the deferred RTK cache reset while streaming,
//   - the socket connectivity icon (kept as the 12th shell item so its id is
//     SHELL-012, which spec §5.5 references by name),
//   - the 13 global-create entity types (createEntity.constant.js
//     DropdownItems) with per-type permissions and target routes,
//   - SimpleCreateRoutes suppression of the create button,
//   - the commented-out feedback dialog (ships ENABLED under waiver W-007,
//     decision D5).
import path from 'node:path';
import { BASELINE, parseFile, src, traverse, writeOut } from './common.mjs';

const SIDEBAR_BODY = 'src/[fsd]/widgets/sidebar-root/ui/SidebarBody.jsx';
const CREATE_CONST = 'src/[fsd]/widgets/sidebar-root/lib/constants/createEntity.constant.js';
const SIDEBAR = 'src/[fsd]/widgets/sidebar-root/ui/Sidebar.jsx';
const ROOT = 'src/[fsd]/app/root.jsx';

const out = [];

// --- sidebar entries from the sections array --------------------------------
{
  const { ast, code } = parseFile(path.join(BASELINE, SIDEBAR_BODY));
  const entries = [];
  let sectionsLoc = null;
  let filterLoc = null;
  traverse(ast, {
    VariableDeclarator(p) {
      if (p.node.id.name !== 'allSections') return;
      sectionsLoc = [p.node.loc.start.line, p.node.loc.end.line];
      let group = 0;
      for (const section of p.node.init.elements) {
        group++;
        for (const item of section.elements) {
          const rec = { group, line: item.loc.start.line };
          for (const prop of item.properties) {
            if (prop.type !== 'ObjectProperty') continue;
            const k = prop.key.name;
            if (['value', 'label', 'breadCrumb', 'tooltip'].includes(k) && prop.value.type === 'StringLiteral')
              rec[k] = prop.value.value;
            if (k === 'url' && prop.value.type === 'MemberExpression') rec.routeKey = prop.value.property.name;
          }
          entries.push(rec);
        }
      }
    },
  });
  // filter block: locate the filteredSections declaration
  const lines = code.split('\n');
  lines.forEach((l, i) => {
    if (l.includes('const filteredSections')) filterLoc = i + 1;
  });
  for (const e of entries) {
    out.push({
      kind: 'sidebar-entry',
      value: e.value, label: e.label, group: e.group, routeKey: e.routeKey,
      sources: [src(SIDEBAR_BODY, e.line)],
    });
  }
  out.push({
    kind: 'sidebar-filtering',
    sources: [src(SIDEBAR_BODY, filterLoc, filterLoc + 15), src(SIDEBAR_BODY, sectionsLoc[0], sectionsLoc[0])],
  });
  // deferred cache reset while streaming (navigateToPage)
  let navLine = null;
  lines.forEach((l, i) => { if (l.includes('const navigateToPage')) navLine = i + 1; });
  out.push({ kind: 'deferred-cache-reset', sources: [src(SIDEBAR_BODY, navLine, navLine + 25)] });
  // socket connectivity icon — SHELL item #12 by construction
  let iconLine = null;
  lines.forEach((l, i) => { if (l.includes('useSocketIcon()')) iconLine = i + 1; });
  out.push({
    kind: 'socket-indicator',
    sources: [src(ROOT, 35, 71), src(SIDEBAR_BODY, iconLine)],
  });
  if (out.filter(x => x.kind === 'sidebar-entry').length + 3 !== 12)
    throw new Error('SHELL ordering broken: socket-indicator is not item #12');
}

// --- create-entity types -----------------------------------------------------
{
  const { ast } = parseFile(path.join(BASELINE, CREATE_CONST));
  const perms = new Map(); // option -> {perms:[], line}
  const cmdPath = new Map(); // option -> routeKey/undefined
  traverse(ast, {
    VariableDeclarator(p) {
      const name = p.node.id.name;
      if (name === 'CreationPermissions') {
        for (const prop of p.node.init.properties) {
          if (prop.type !== 'ObjectProperty') continue;
          const key = prop.key.name || prop.key.value;
          const val = [];
          if (prop.value.type === 'ArrayExpression')
            for (const el of prop.value.elements) {
              const parts = [];
              let n = el;
              while (n && n.type === 'MemberExpression') { parts.unshift(n.property.name); n = n.object; }
              parts.length && val.push(parts.join('.'));
            }
          perms.set(key, { perms: val, line: prop.loc.start.line });
        }
      }
      if (name === 'CommandPathMap') {
        for (const prop of p.node.init.properties) {
          if (prop.type !== 'ObjectProperty') continue;
          const key = prop.key.name || prop.key.value;
          cmdPath.set(key, prop.value.type === 'MemberExpression' ? prop.value.property.name : null);
        }
      }
      if (name === 'DropdownItems') {
        for (const item of p.node.init.elements) {
          const rec = { line: item.loc.start.line };
          for (const prop of item.properties) {
            const k = prop.key.name;
            if (k === 'label' && prop.value.type === 'StringLiteral') rec.label = prop.value.value;
            if (k === 'option' && prop.value.type === 'StringLiteral') rec.option = prop.value.value;
            if (k === 'route')
              rec.route = prop.value.type === 'StringLiteral' ? prop.value.value : prop.value.property?.name;
          }
          out.push({ kind: 'create-entity', ...rec, sources: [src(CREATE_CONST, rec.line)] });
        }
      }
      if (name === 'SimpleCreateRoutes') {
        out.push({
          kind: 'simple-create-routes',
          routes: p.node.init.elements.map(el =>
            el.type === 'StringLiteral' ? el.value : el.property?.name),
          sources: [src(CREATE_CONST, p.node.loc.start.line, p.node.loc.end.line)],
        });
      }
    },
  });
  // attach permissions + target path to create-entity items
  for (const item of out.filter(x => x.kind === 'create-entity')) {
    const pr = perms.get(item.option);
    if (pr) {
      item.permissions = pr.perms;
      item.sources.push(src(CREATE_CONST, pr.line));
    }
    item.targetRouteKey = cmdPath.get(item.option) ?? null;
  }
  const n = out.filter(x => x.kind === 'create-entity').length;
  if (n !== 13) throw new Error(`expected 13 create-entity types, got ${n}`);
}

// --- feedback dialog (W-007 / D5) ---------------------------------------------
{
  const { code } = parseFile(path.join(BASELINE, SIDEBAR));
  const lines = code.split('\n');
  const l1 = lines.findIndex(l => l.includes('useSearchBar()')) + 1;
  const l2 = lines.findIndex(l => l.includes('<FeedbackDialog />')) + 1;
  if (!l1 || !l2) throw new Error('feedback dialog evidence not found in Sidebar.jsx');
  out.push({ kind: 'feedback-dialog', sources: [src(SIDEBAR, l1), src(SIDEBAR, l2)] });
}

console.log('shell items:', out.length, '(#12 =', out[11].kind + ')');
writeOut('shell.json', out);
