#!/usr/bin/env node
/**
 * Phase 0 of docs/plans/route-wiring-plan.md — freeze the route -> page map.
 *
 * Emits `parity/route-wiring-map.json`: one row per route that currently
 * renders scaffolding instead of its built page component.
 *
 * MECHANICAL fields (re-derived on every run, never hand-edited):
 *   routeFile, url, routeNum, specUrl, target, rendersRouteShell, pageImports
 * — all read out of the route file itself. Every stub route carries a
 * `ROUTE-NNN \`/url\` -> \`Component\`` docstring naming its target; that
 * docstring IS the contract.
 *
 * CURATED fields (RESOLUTION below, hand-authored from evidence, reviewed):
 *   targetPath, targetExport, requiredProps, status, note
 *
 * Run: node scripts/build-route-wiring-map.mjs [--check]
 * `--check` exits non-zero if the emitted map differs from the committed one
 * (CI use), so the map cannot silently drift from the routes.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROUTES = 'src/routes';
const OUT = 'parity/route-wiring-map.json';

/**
 * status values:
 *   ready              - target exists, no route-owned state needed; a
 *                        near-mechanical import swap.
 *   needs-route-state  - target exists but requires props the route must own
 *                        (tab/search state, navigation callbacks, projectId).
 *                        Real work, no external blocker.
 *   blocked-codegen    - target requires an injected `deps` writer whose
 *                        endpoint is absent from
 *                        src/shared/api/endpoints.manifest.json. The Go
 *                        handler EXISTS (see note); the generated client does
 *                        not cover it. Blocked on codegen, not on backend.
 *   hybrid-defect      - already renders the real page, but ALSO renders a
 *                        RouteShell heading above it. Remove the shell.
 *   page-is-stub       - route is wired, but the page component it renders is
 *                        itself scaffolding.
 */
const RESOLUTION = {
  // ---- agents (A1) ----
  '_shell/agents-hub.tsx': ['pages/agents-hub/AgentHub', 'AgentHub', [], 'ready', 'AgentHubProps is intentionally empty — "route props are handled at the route layer".'],
  '_shell/agents/$tab.tsx': ['pages/agents/Applications', 'Applications', [], 'ready', 'Route keeps its ExclusiveOutlet composition; only the leaf component changes.'],
  '_shell/agents/$tab.$agentId.tsx': ['pages/agents/EditApplication', 'EditApplication', [], 'ready', ''],
  '_shell/agents/create.tsx': ['pages/agents/CreateApplication', 'CreateApplication', [], 'ready', ''],

  // ---- apps (A6) ----
  '_shell/apps/index.tsx': ['pages/apps/Apps', 'Apps', [], 'ready', ''],
  '_shell/apps/$tab.tsx': ['pages/apps/Apps', 'Apps', [], 'ready', ''],
  '_shell/apps/$tab.$appId.tsx': ['pages/apps/AppDetail', 'AppDetail', [], 'ready', ''],
  '_shell/apps/create.tsx': ['pages/toolkits/CreateToolkit', 'CreateToolkit', ['isApplication', 'deps.createToolkit'], 'blocked-codegen', 'Apps reuse the toolkit creator with isApplication.'],

  // ---- credentials (A7) ----
  '_shell/credentials/$tab.tsx': ['pages/credentials/Credentials', 'Credentials', ['tab', 'projectId', 'onSelectCredential', 'onCreateNew'], 'needs-route-state', 'Route must supply projectId from context and both navigation callbacks.'],
  '_shell/credentials/$tab.$credential_uid.tsx': ['pages/credentials/EditCredential', 'EditCredential', ['context', 'credentialUid', 'onSaved', 'onDiscarded'], 'needs-route-state', 'Docstring target "EditCredentialFromMain" = EditCredential with the main-app context, not a separate component.'],
  '_shell/credentials/create-credential.tsx': ['pages/credentials/CreateCredential', 'CreateCredential', ['context', 'onCreated', 'onCancelled'], 'needs-route-state', 'Docstring target "CreateCredentialFromMain" = CreateCredential with the main-app context.'],

  // ---- misc (A11-A13) ----
  '_shell/help-center.tsx': ['pages/help-center/HelpCenterPage', 'HelpCenterPage', [], 'ready', 'Name drift only: docstring says `Resources`, the built component is HelpCenterPage (also a default export).'],
  '_shell/onboarding.tsx': ['pages/onboarding/Onboarding', 'Onboarding', [], 'ready', 'Route currently renders RouteShell + Outlet; the 398-line Onboarding page is unimported.'],

  // ---- mcps (A5) ----
  '_shell/mcps/$tab.tsx': ['pages/toolkits/Toolkits', 'Toolkits', ['isMCP'], 'ready', 'No pages/mcps list component exists and none is needed — Toolkits already branches on isMCP throughout (Toolkits.tsx:280 names this route family).'],
  '_shell/mcps/create.tsx': ['pages/toolkits/CreateToolkit', 'CreateToolkit', ['isMCP', 'deps.createToolkit'], 'blocked-codegen', ''],
  '_shell/mcps/$tab.$mcpId.tsx': ['pages/toolkits/EditToolkit', 'EditToolkit', ['isMCP', 'deps.saveToolkit'], 'blocked-codegen', ''],

  // ---- pipelines (A2) ----
  '_shell/pipelines/$tab.tsx': ['pages/pipelines/Pipelines', 'Pipelines', [], 'ready', ''],
  '_shell/pipelines/$tab.$agentId.tsx': ['pages/pipelines/EditPipeline', 'EditPipeline', [], 'ready', ''],
  '_shell/pipelines/create.tsx': ['pages/pipelines/CreatePipeline', 'CreatePipeline', [], 'ready', ''],

  // ---- settings (A9, issue #25) ----
  '_shell/settings/create-configuration.tsx': ['pages/credentials/CreateCredential', 'CreateCredential', ['context', 'configurationMode', 'onCreated', 'onCancelled'], 'needs-route-state', ''],
  '_shell/settings/edit-configuration.$credential_uid.tsx': ['pages/credentials/EditCredential', 'EditCredential', ['context', 'credentialUid', 'configurationMode', 'onSaved', 'onDiscarded'], 'needs-route-state', 'ROUTE-065. Param is $credential_uid, NOT $uid — "the MOUNTED route wins".'],
  '_shell/settings/secrets.tsx': ['pages/settings/Secrets', 'SecretsContent', ['shouldCreate', 'search', 'onSearchChange'], 'hybrid-defect', 'Renders SecretsContent AND a RouteShell heading. Also passes search="" / onSearchChange={() => {}} — the search control is dead. Route must own search state.'],
  '_shell/settings/model-configuration.tsx': ['pages/settings/AIConfiguration', 'AIConfiguration', ['projectId'], 'hybrid-defect', 'Renders AIConfiguration AND a RouteShell heading. See also issue #80 (missing ModelConfiguration layer).'],

  // ---- skills (A3, issue #23) ----
  '_shell/skills/$tab.tsx': ['pages/skills/Skills', 'Skills', [], 'ready', ''],
  '_shell/skills/$tab.$skillId.tsx': ['pages/skills/EditSkill', 'EditSkill', [], 'ready', ''],
  '_shell/skills/create.tsx': ['pages/skills/CreateSkill', 'CreateSkill', [], 'ready', ''],

  // ---- toolkits (A4) ----
  '_shell/toolkits/$tab.tsx': ['pages/toolkits/Toolkits', 'Toolkits', [], 'ready', ''],
  '_shell/toolkits/create.tsx': ['pages/toolkits/CreateToolkit', 'CreateToolkit', ['deps.createToolkit'], 'blocked-codegen', ''],
  '_shell/toolkits/$tab.$toolkitId.tsx': ['pages/toolkits/EditToolkit', 'EditToolkit', ['deps.saveToolkit'], 'blocked-codegen', ''],

  // ---- user-public (A13) ----
  '_shell/user-public/$tab.tsx': ['pages/user-public/ui/UserPublicPage', 'UserPublicPage', ['tab', 'onTabChange', 'statuses', 'onStatusesChange', 'authorId', 'authorName'], 'needs-route-state', 'Heaviest route-owned state in the set: tab + status filters + author identity.'],
  '_shell/user-public/agents.$agentId.tsx': ['pages/agents/EditApplication', 'EditApplication', [], 'ready', ''],
  '_shell/user-public/pipelines.$agentId.tsx': ['pages/pipelines/EditPipeline', 'EditPipeline', [], 'ready', ''],
  '_shell/user-public/apps.$appId.tsx': ['pages/apps/AppDetail', 'AppDetail', [], 'ready', ''],
  '_shell/user-public/toolkits.$toolkitId.tsx': ['pages/toolkits/EditToolkit', 'EditToolkit', ['deps.saveToolkit'], 'blocked-codegen', ''],
  '_shell/user-public/mcps.$mcpId.tsx': ['pages/toolkits/EditToolkit', 'EditToolkit', ['isMCP', 'deps.saveToolkit'], 'blocked-codegen', ''],

  // ---- artifacts (A8) — inline stubs added by PR #82, NOT RouteShell ----
  '_shell/artifacts/index.tsx': ['pages/artifacts/Artifacts', 'Artifacts', [], 'ready', 'Currently a hand-written heading + one Button. The 363-line Artifacts page is unimported. Revert the stub rather than editing it.'],
  '_shell/artifacts/create-bucket.tsx': ['pages/artifacts/CreateBucket', 'CreateBucket', [], 'ready', 'Currently a TextField whose submit only navigates — no API call. CreateBucket (built, tested) is unimported.'],

  // ---- wired, but to scaffolding ----
  '_shell/mode-switch.tsx': ['pages/mode-switch/ModeSwitch', 'ModeSwitch', [], 'page-is-stub', 'Route IS wired. ModeSwitch itself renders <div><h1>Switch Mode</h1></div> with its toggle behind `const enableToggle = false`. Not a wiring defect — a page gap.'],
};

const DOMAIN = (f) => {
  const m = f.match(/^_shell\/([^/.]+)/);
  const d = m ? m[1] : 'root';
  return ['agents-hub', 'help-center', 'onboarding', 'mode-switch'].includes(d) ? 'misc' : d;
};

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.tsx') && !p.includes('.test.') && !p.includes('__tests__')) acc.push(p);
  }
  return acc;
}

const rows = [];
for (const file of walk(ROUTES).sort()) {
  const rel = relative(ROUTES, file);
  if (rel.startsWith('-')) continue; // -ui/, -guards/, -search/ helpers
  const txt = readFileSync(file, 'utf8');
  const key = rel;
  if (!(key in RESOLUTION)) continue;

  const url = txt.match(/createFileRoute\(\s*['"]([^'"]+)/)?.[1] ?? null;
  const doc = txt.match(/ROUTE-(\d+)\s+`([^`]*)`\s*(?:->|->)\s*\n?\s*\*?\s*`([^`]*)`/);
  const [targetPath, targetExport, requiredProps, status, note] = RESOLUTION[key];

  rows.push({
    routeFile: `${ROUTES}/${rel}`,
    domain: DOMAIN(rel),
    url,
    routeNum: doc ? `ROUTE-${doc[1]}` : null,
    specUrl: doc ? doc[2] : null,
    docstringTarget: doc ? doc[3] : null,
    targetPath: `src/${targetPath}.tsx`,
    targetExport,
    requiredProps,
    status,
    rendersRouteShell: /-ui\/RouteShell'/.test(txt),
    note,
  });
}

const missing = rows.filter((r) => !existsSync(r.targetPath));
if (missing.length) {
  console.error('Unresolvable targets:', missing.map((m) => `${m.routeFile} -> ${m.targetPath}`));
  process.exit(2);
}

const byStatus = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
const out = {
  $comment: 'Generated by scripts/build-route-wiring-map.mjs — Phase 0 of docs/plans/route-wiring-plan.md. Do not hand-edit; edit RESOLUTION in the script.',
  generated: 'phase-0',
  total: rows.length,
  byStatus,
  byDomain: rows.reduce((a, r) => ({ ...a, [r.domain]: (a[r.domain] ?? 0) + 1 }), {}),
  routes: rows,
};

const json = `${JSON.stringify(out, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== json) {
    console.error(`${OUT} is stale — re-run: node scripts/build-route-wiring-map.mjs`);
    process.exit(1);
  }
  console.log(`${OUT} up to date (${rows.length} routes).`);
} else {
  writeFileSync(OUT, json);
  console.log(`Wrote ${OUT}: ${rows.length} routes`, byStatus);
}
