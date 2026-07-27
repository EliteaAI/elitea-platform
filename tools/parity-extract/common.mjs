// Shared helpers for the P1 parity-manifest extraction (spec §8.3 steps 1–7).
// Everything here is read-only over the pinned baseline.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

export const traverse = traverseModule.default || traverseModule;

// Default baseline = the repo's apps/elitea-ui submodule checkout (CI);
// override with BASELINE=<abs path> when running from a worktree whose
// submodules are deliberately unpopulated (decision-record operational note).
export const BASELINE =
  process.env.BASELINE ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'apps', 'elitea-ui');

export const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(OUT, { recursive: true });

export function rel(abs) {
  return path.relative(BASELINE, abs);
}

// Manifest source entries are repo-relative: "apps/elitea-ui/<rel>:<line>"
export function src(relPath, line, endLine) {
  const span = endLine && endLine !== line ? `${line}-${endLine}` : `${line}`;
  return `apps/elitea-ui/${relPath}:${span}`;
}

export function read(relPath) {
  return fs.readFileSync(path.join(BASELINE, relPath), 'utf8');
}

export function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) yield p;
  }
}

export function allSourceFiles() {
  return [...walk(path.join(BASELINE, 'src'))];
}

const astCache = new Map();
export function parseFile(abs) {
  if (astCache.has(abs)) return astCache.get(abs);
  const code = fs.readFileSync(abs, 'utf8');
  let ast = null;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'classProperties', 'objectRestSpread', 'dynamicImport'],
      errorRecovery: true,
    });
  } catch (e) {
    console.error(`PARSE FAIL ${rel(abs)}: ${e.message}`);
  }
  const entry = { ast, code };
  astCache.set(abs, entry);
  return entry;
}

export function writeOut(name, data) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2) + '\n');
  const n = Array.isArray(data) ? data.length : Object.keys(data).length;
  console.log(`${name}: ${n} entries`);
}

// ---- screen / domain attribution ------------------------------------------
// Maps a baseline file path (relative) to {screen, domain}. Ordered: first
// prefix match wins. Documented in REPRODUCE.md.
const SCREEN_MAP = [
  ['src/pages/NewChat', 'chat', 'chat'],
  ['src/[fsd]/features/chat/conversation-list', 'chat-conversation-list', 'chat'],
  ['src/[fsd]/features/chat', 'chat', 'chat'],
  ['src/hooks/chat', 'chat', 'chat'],
  ['src/pages/Applications', 'agents', 'agents'],
  ['src/[fsd]/features/agent', 'agents', 'agents'],
  ['src/[fsd]/entities/run-history', 'run-history', 'agents'],
  ['src/[fsd]/entities/import-wizard', 'import-wizard', 'agents'],
  ['src/[fsd]/pages/skills', 'skills', 'skills'],
  ['src/[fsd]/features/skill', 'skills', 'skills'],
  ['src/pages/Pipelines', 'pipelines', 'pipelines'],
  ['src/[fsd]/features/pipelines', 'pipelines', 'pipelines'],
  ['src/pages/Credentials', 'credentials', 'credentials'],
  ['src/[fsd]/features/credentials', 'credentials', 'credentials'],
  ['src/pages/Toolkits', 'toolkits', 'toolkits'],
  ['src/[fsd]/features/toolkits/indexes', 'indexes', 'indexes'],
  ['src/[fsd]/features/toolkits', 'toolkits', 'toolkits'],
  ['src/[fsd]/pages/apps', 'apps', 'apps'],
  ['src/[fsd]/pages/mcp', 'mcp-auth', 'mcps'],
  ['src/[fsd]/features/mcp', 'mcps', 'mcps'],
  ['src/pages/Artifacts', 'artifacts', 'artifacts'],
  ['src/[fsd]/features/artifacts', 'artifacts', 'artifacts'],
  ['src/[fsd]/pages/settings/Secrets', 'settings-secrets', 'secrets'],
  ['src/[fsd]/pages/settings/Users', 'settings-users', 'users'],
  ['src/[fsd]/pages/settings/PersonalTokens', 'settings-tokens', 'tokens'],
  ['src/[fsd]/pages/settings/CreatePersonalToken', 'settings-tokens', 'tokens'],
  ['src/[fsd]/pages/settings/AIConfiguration', 'settings-model-configuration', 'credentials'],
  ['src/[fsd]/pages/settings', 'settings', 'shell'],
  ['src/[fsd]/features/settings', 'settings', 'shell'],
  ['src/pages/UserSettings', 'settings-personalization', 'shell'],
  ['src/pages/NotificationCenter', 'notifications', 'notifications'],
  ['src/[fsd]/features/analytics', 'analytics', 'analytics'],
  ['src/pages/UserPublic', 'user-public', 'public'],
  ['src/pages/Onboarding', 'onboarding', 'shell'],
  ['src/[fsd]/pages/resources', 'help-center', 'shell'],
  ['src/[fsd]/pages/agent-hub', 'agents-hub', 'shell'],
  ['src/pages/ModeSwitch', 'mode-switch', 'shell'],
  ['src/[fsd]/pages/auth', 'auth-callback', 'shell'],
  ['src/[fsd]/widgets/sidebar-root', 'sidebar', 'shell'],
  ['src/[fsd]/widgets/support-assistant', 'support-assistant', 'shell'],
  ['src/[fsd]/widgets', 'shell-widgets', 'shell'],
  ['src/pages/Common', 'shared-page-components', 'shell'],
  ['src/pages/ProjectSwitcher', 'project-switcher', 'shell'],
  ['src/utils/shareUtils', 'artifacts', 'artifacts'],
  ['src/api', 'api-layer', 'shell'],
  ['src/slices', 'state-layer', 'shell'],
];

export function screenOf(relPath) {
  for (const [prefix, screen, domain] of SCREEN_MAP) {
    if (relPath.startsWith(prefix)) return { screen, domain };
  }
  return { screen: 'shared', domain: 'shell' };
}

// API module -> {domain, unit}: mechanical map, documented in REPRODUCE.md.
export const API_MODULE_MAP = {
  'src/api/applications.js': { domain: 'agents', unit: 'A1' },
  'src/api/artifacts.js': { domain: 'artifacts', unit: 'A8' },
  'src/api/auth.js': { domain: 'shell', unit: 'F4' },
  'src/api/admin.js': { domain: 'admin', unit: 'A14' },
  'src/api/chatConfig.js': { domain: 'chat', unit: 'C1' },
  'src/api/configurations.js': { domain: 'credentials', unit: 'A7' },
  'src/api/llm.js': { domain: 'credentials', unit: 'A9' },
  'src/api/mcpOAuth.js': { domain: 'mcps', unit: 'A5' },
  'src/api/notifications.js': { domain: 'notifications', unit: 'A11' },
  'src/api/platformSettings.js': { domain: 'shell', unit: 'F3' },
  'src/api/project.js': { domain: 'shell', unit: 'W-shell' },
  'src/api/projectContext.js': { domain: 'shell', unit: 'A9' },
  'src/api/resources.js': { domain: 'shell', unit: 'A13' },
  'src/api/search.js': { domain: 'shell', unit: 'W-shell' },
  'src/api/secrets.js': { domain: 'secrets', unit: 'A9' },
  'src/api/social.js': { domain: 'public', unit: 'A12' },
  'src/api/tags.js': { domain: 'shell', unit: 'E1' },
  'src/api/toolkits.js': { domain: 'toolkits', unit: 'A4' },
  'src/api/trendingAuthor.js': { domain: 'public', unit: 'A12' },
  'src/[fsd]/entities/import-wizard/api/importWizardApi.js': { domain: 'agents', unit: 'A1' },
  'src/[fsd]/entities/run-history/api/runHistoryApi.js': { domain: 'agents', unit: 'A1' },
  'src/[fsd]/features/agent/api/agentCategoriesApi.js': { domain: 'agents', unit: 'A1' },
  'src/[fsd]/features/agent/api/generateAgentDraftApi.js': { domain: 'agents', unit: 'A1' },
  'src/[fsd]/features/analytics/api/analyticsApi.js': { domain: 'analytics', unit: 'A10' },
  'src/[fsd]/features/chat/api/chat.api.js': { domain: 'chat', unit: 'C1' },
  'src/[fsd]/features/chat/conversation-list/api/conversationList.api.js': { domain: 'chat', unit: 'C2' },
  'src/[fsd]/features/settings/api/generateProjectContextDraftApi.js': { domain: 'shell', unit: 'A9' },
  'src/[fsd]/features/settings/api/projectInfoApi.js': { domain: 'shell', unit: 'A9' },
  'src/[fsd]/features/skill/api/generateSkillDraftApi.js': { domain: 'skills', unit: 'A3' },
  'src/[fsd]/features/skill/api/skillsApi.js': { domain: 'skills', unit: 'A3' },
  'src/[fsd]/features/toolkits/indexes/api/indexesApi.js': { domain: 'indexes', unit: 'A4' },
  'src/[fsd]/widgets/support-assistant/api/supportAssistantConfigApi.js': { domain: 'shell', unit: 'W-shell' },
};

// domain -> owning Wave-2 unit for behaviour/action items (REPRODUCE.md).
export const DOMAIN_UNIT = {
  shell: 'W-shell',
  chat: 'C1',
  agents: 'A1',
  pipelines: 'A2',
  skills: 'A3',
  toolkits: 'A4',
  mcps: 'A5',
  apps: 'A6',
  credentials: 'A7',
  artifacts: 'A8',
  indexes: 'A4',
  secrets: 'A9',
  users: 'A9',
  tokens: 'A9',
  notifications: 'A11',
  analytics: 'A10',
  public: 'A12',
  admin: 'A14',
};

// unit -> coverage anchor {file,min} per spec §9.3 coverage floors.
export const UNIT_COVERAGE = {
  S1: { file: 'src/shared/ui/index.ts', min: 95 },
  F3: { file: 'src/shared/config/index.ts', min: 95 },
  F4: { file: 'src/shared/api/http.ts', min: 95 },
  R1: { file: 'src/app/router.tsx', min: 90 },
  R3: { file: 'src/routes/$projectId.$.tsx', min: 95 },
  S5: { file: 'src/shared/api/socket/client.ts', min: 95 },
  S6: { file: 'src/shared/api/upload.ts', min: 95 },
  E1: { file: 'src/entities/index.ts', min: 90 },
  C1: { file: 'src/processes/chat/model/index.ts', min: 88 },
  C2: { file: 'src/features/chat-conversation-list/index.ts', min: 88 },
  C3: { file: 'src/features/chat-input/index.ts', min: 88 },
  C4: { file: 'src/features/chat-messages/index.ts', min: 88 },
  C5: { file: 'src/features/chat-participants/index.ts', min: 88 },
  C6: { file: 'src/pages/chat/index.ts', min: 80 },
  A1: { file: 'src/features/agents/index.ts', min: 88 },
  A2: { file: 'src/features/pipelines/index.ts', min: 88 },
  A3: { file: 'src/features/skills/index.ts', min: 88 },
  A4: { file: 'src/features/toolkits/index.ts', min: 88 },
  A5: { file: 'src/features/mcps/index.ts', min: 88 },
  A6: { file: 'src/features/apps/index.ts', min: 88 },
  A7: { file: 'src/features/credentials/index.ts', min: 88 },
  A8: { file: 'src/features/artifacts/index.ts', min: 88 },
  A9: { file: 'src/features/settings/index.ts', min: 88 },
  A10: { file: 'src/features/analytics/index.ts', min: 88 },
  A11: { file: 'src/features/notifications/index.ts', min: 88 },
  A12: { file: 'src/pages/user-public/index.ts', min: 80 },
  A13: { file: 'src/pages/onboarding/index.ts', min: 80 },
  A14: { file: 'src/pages/admin/index.ts', min: 85 },
  'W-shell': { file: 'src/widgets/sidebar/index.ts', min: 85 },
  V1: { file: 'e2e/journeys.spec.ts', min: 0 },
  V2: { file: 'e2e/visual/visual.spec.ts', min: 0 },
};
