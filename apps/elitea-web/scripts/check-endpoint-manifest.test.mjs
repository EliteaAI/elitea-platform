import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * CLI-level RED/GREEN proof for check-endpoint-manifest.mjs (unit S4, the
 * R-A5 enforcement mechanism) — spawns the REAL script (same technique
 * check-gates-selftest.mjs uses for the other gate scripts), so this test
 * fails if the script's argument parsing, exit code, or fs wiring regress,
 * not just its imported logic (endpoint-manifest-core.test.mjs covers
 * that separately).
 */

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(SCRIPT_DIR, '..');
const SCRIPT = join(SCRIPT_DIR, 'check-endpoint-manifest.mjs');
const REAL_GENERATED_DIR = join(APP_ROOT, 'src', 'shared', 'api', 'generated');
const REAL_PARITY_DIR = join(APP_ROOT, 'parity', 'manifest');

let dirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 's4-check-endpoint-manifest-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

/**
 * Every fixture below holds one or two entries, which is far under the
 * manifest floor issue #528 added. `--min-entries 0` is the deliberate opt-out
 * for exactly that case: a fixture is a NAMED subject of a known size, not a
 * manifest that collapsed. CI passes no flag and gets the real floor, and the
 * "RED — an empty manifest" case below proves that floor still bites.
 */
function run(manifestPath, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      SCRIPT, '--manifest', manifestPath, '--generated-dir', REAL_GENERATED_DIR,
      '--parity-dir', REAL_PARITY_DIR, '--min-entries', '0', ...extraArgs,
    ],
    { encoding: 'utf8' },
  );
}

function fixture(dir, name, doc) {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

describe('RED — rule (a): source:generated with no operationId', () => {
  it('exits 1 and names rule (a)', () => {
    const dir = makeTempDir();
    const file = fixture(dir, 'red-a.json', {
      version: 1,
      endpoints: [
        { id: 'test.a', method: 'GET', path: '/x', operationId: null, source: 'generated', responseSchema: null, fixture: null, usedBy: [] },
      ],
    });
    const result = run(file);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('has no operationId (rule a)');
    expect(result.stdout).toContain('check-endpoint-manifest: FAIL');
  });
});

describe('RED — rule (b): operationId not in the generated set', () => {
  it('exits 1 and names rule (b)', () => {
    const dir = makeTempDir();
    const file = fixture(dir, 'red-b.json', {
      version: 1,
      endpoints: [
        {
          id: 'test.b',
          method: 'GET',
          path: '/x',
          operationId: 'thisOperationDoesNotExistAnywhere',
          source: 'generated',
          responseSchema: null,
          fixture: null,
          usedBy: [],
        },
      ],
    });
    const result = run(file);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('is not in the generated set (rule b)');
    expect(result.stdout).toContain('check-endpoint-manifest: FAIL');
  });
});

describe('RED — duplicate ids', () => {
  it('exits 1', () => {
    const dir = makeTempDir();
    const file = fixture(dir, 'red-dup.json', {
      version: 1,
      endpoints: [
        { id: 'dup', method: 'GET', path: '/a', operationId: 'roleList', source: 'generated', responseSchema: null, fixture: null, usedBy: [] },
        { id: 'dup', method: 'GET', path: '/b', operationId: 'userList', source: 'generated', responseSchema: null, fixture: null, usedBy: [] },
      ],
    });
    const result = run(file);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('duplicate id "dup"');
  });
});

/**
 * Issue #528. `"endpoints": []` used to print "check-endpoint-manifest: OK".
 * Nothing floored the manifest side, so an emptied file read as a clean one.
 */
describe('RED — an empty manifest', () => {
  it('exits 2 rather than reporting OK over nothing', () => {
    const dir = makeTempDir();
    const file = fixture(dir, 'red-empty.json', { version: 1, endpoints: [] });
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--manifest', file, '--generated-dir', REAL_GENERATED_DIR, '--parity-dir', REAL_PARITY_DIR],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('the subject set is empty or too small');
    expect(result.stdout).not.toContain('check-endpoint-manifest: OK');
  });

  it('a manifest just under the floor is refused too, not only an empty one', () => {
    const dir = makeTempDir();
    const file = fixture(dir, 'red-thin.json', {
      version: 1,
      endpoints: [
        { id: 'only.one', method: 'GET', path: '/x', operationId: null, source: 'handwritten', responseSchema: null, fixture: null, usedBy: [] },
      ],
    });
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--manifest', file, '--generated-dir', REAL_GENERATED_DIR, '--parity-dir', REAL_PARITY_DIR, '--min-entries', '2'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('1 entries in');
  });

  it('--min-entries rejects a value that is not a whole count', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--min-entries', 'lots'], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--min-entries needs a whole number');
  });
});

describe('GREEN — a handwritten entry with operationId:null is legal', () => {
  it('exits 0', () => {
    const dir = makeTempDir();
    const file = fixture(dir, 'green-handwritten.json', {
      version: 1,
      endpoints: [
        { id: 'credentials.createSecret', method: 'POST', path: '/x', operationId: null, source: 'handwritten', responseSchema: 'SecretSchema', fixture: null, usedBy: [] },
      ],
    });
    const result = run(file);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('check-endpoint-manifest: OK');
  });
});

/**
 * The two counts below are deliberately hardcoded rather than derived: a test
 * that recomputes them from the same source it is checking asserts nothing.
 * They are a tripwire — regenerating the client or appending to the manifest is
 * expected to bump them, and doing so consciously is the point.
 *
 * 92 -> 102 when the artifacts/objects + transfer-grant operations landed with
 * this branch's v2.yaml expansion.
 * 102 -> 109 when #151 added the seven `secrets` paths, a domain v2.yaml had
 * never described — which is why nothing generated or contract-tested caught
 * the URL divergence #137 codified.
 * 109 -> 104 when #126 retired the prototype indexer transport: five spec
 * operations lost the routes behind them (`getPipelineTrigger`,
 * `updatePipelineTrigger`, `generateAgentDraft`, `webchatSync`,
 * `getChatConfig`) and were removed from v2.yaml. This is a DELIBERATE
 * downward bump — the first one — and the tripwire firing is it working.
 * 180 -> 179 in the same change: `chat.webchatSync` was dropped (its
 * operation, its route and its callers are all gone); the other four flipped
 * to `source: handwritten` rather than disappearing, because the app still
 * issues those exact requests.
 * 104 -> 106 when issue #251 added the social-avatar routes: two new spec
 * operations (`getCurrentSocialAvatar`, `uploadCurrentSocialAvatar`) landed
 * in v2.yaml alongside internal/api/v2/social/avatar.go. Neither is
 * in the endpoint manifest yet (it stays handwritten, not yet landed, same
 * as most P1 API-* items), so MANIFEST_ENTRY_COUNT is unchanged.
 * 106 -> 117 when issue #249 added skill-level publishing: eleven new spec
 * operations (publishSkill, unpublishSkill, validateSkillForPublish,
 * listPublicSkills, getPublicSkill, getPublicSkillVersion, attachPublicSkill,
 * listSkillCategories, exportSkillFork, exportSkillVersionFork,
 * listAgentsWithSkill) landed in v2.yaml alongside
 * internal/api/v2/skillpublish. None is in the endpoint manifest yet — that
 * PR ships no UI — so MANIFEST_ENTRY_COUNT is again unchanged.
 * 117 -> 120 when issue #252 added the MCP surface: three new spec operations
 * (listRegisteredMcpServers, callRegisteredMcpServerTool,
 * getInternalMcpPatStatus) landed in v2.yaml alongside
 * internal/api/v2/mcp. The MCP protocol endpoints that change also adds
 * (/app/{project_id}/mcp and its variants) are JSON-RPC and deliberately not
 * in v2.yaml, so they do not count. No UI ships with it, so
 * MANIFEST_ENTRY_COUNT is unchanged.
 * 120 -> 129 when issue #255 added the admin & tenancy parity surface: nine new
 * spec operations (listUserModeRoles, assignUserModeRole, removeUserModeRole,
 * inviteUserGlobally, getUserProjectPermissions, updateUserProjectPermissions,
 * addProjectGroup, removeProjectGroup, listAdminPublishedAgents) landed in
 * v2.yaml alongside internal/api/v2/admin, internal/api/v2/projects and
 * internal/api/v2/eliteacore. `putProjectGroups` was already counted — that PR
 * reshapes it (it stopped echoing the request body) without adding an
 * operation. No UI ships with it, so MANIFEST_ENTRY_COUNT is unchanged.
 * 129 -> 142 when issue #246 ported the budgets/quotas/usage domain: thirteen
 * new spec operations (getProjectBudget, getProjectBudgetAdmin,
 * setProjectBudget, listProjectBudgets, getMemberBudget, getMemberBudgetAdmin,
 * setMemberBudget, listMemberBudgets, listMemberBudgetsAdmin, getProjectUsage,
 * getProjectQuota, setProjectQuota, getProjectStatistics) landed in v2.yaml
 * alongside internal/api/v2/budgets and internal/api/v2/projects/quota.go, and
 * with them the spec's first `budgets` tag. No UI ships with it (#80 tracks the
 * settings page), so MANIFEST_ENTRY_COUNT is unchanged.
 * 142 -> 145 when issue #253 added the cost breakdown and the two chat
 * execution-step trace reads: three new spec operations (getAnalyticsCosts,
 * listMessageTraces, getMessageTrace) landed in v2.yaml alongside
 * internal/api/v2/analytics/costs.go and internal/api/v2/messagetraces, and
 * with them the spec's first `chat` tag. No UI ships with it — the old app's
 * trace-pin fetch is recorded as unported in
 * src/processes/chat/model/useLoadMoreMessages.ts — so MANIFEST_ENTRY_COUNT is
 * unchanged.
 * 145 -> 151 when issue #250 added the tracing ingest surface: six new spec
 * operations (collectTracesUngated, collectTraces, proxyOtlpTracesUngated,
 * proxyOtlpTraces, getTracingStatusForProject, getTracingStatusAdmin) landed
 * in v2.yaml alongside internal/api/v2/tracing, and with them the spec's
 * first `tracing` tag. No UI ships with it (the routes exist for the OTel
 * collector proxy and elitea-main's own span export, not for a settings
 * page), so MANIFEST_ENTRY_COUNT is unchanged.
 * 151 -> 152 when issue #336 added the expanded version read: one new spec
 * operation (getApplicationVersionDetailExpanded, a body-less PATCH that reads
 * the secret-resolved version detail) landed in v2.yaml alongside
 * internal/api/v2/applications/handler.go's GetVersionExpanded. Only elitea-sdk
 * calls it, and it needs the `X-SECRET` header, so no UI ships with it and
 * MANIFEST_ENTRY_COUNT is unchanged.
 * 152 -> 153 when the secrets domain's `administration` mode was documented:
 * one new spec operation (`createSecretInMode`, POST
 * /secrets/secret/{mode}/{projectID}/{name}) landed in v2.yaml. The route has
 * existed since internal/api/v2/secrets/admin.go's AdminCreate; only the spec
 * was missing it, which is why the admin Secrets page had to hand-roll its
 * client. No new UI ships with it, so MANIFEST_ENTRY_COUNT is unchanged.
 *
 * 179 -> 180: `analytics.getAnalyticsCosts`. The operation was generated all
 * along and had NO manifest entry and no caller anywhere outside generated code
 * — the only /analytics_* route backed by a real table, unread, while the
 * Analytics page displayed a cost KPI of 0 from the usage endpoint's hardcoded
 * literal. GENERATED_OPERATION_COUNT is unchanged because the operation is not
 * new; only its registration is.
 *
 * 153 -> 157 AND 180 -> 184 together, when the in-app support assistant was
 * ported: four new spec operations (listSupportConversations,
 * createSupportConversation, getSupportConversation, startSupportTurn) landed
 * in v2.yaml alongside internal/api/v2/supportassistant.
 *
 * BOTH COUNTS MOVE, which is the unusual half and the point of recording it:
 * every entry above this one moved GENERATED_OPERATION_COUNT alone, because
 * those PRs shipped a backend with no UI. This one ships the widget too
 * (widgets/support-assistant, mounted by widgets/app-shell), so each operation
 * acquires a manifest entry in the same change — and every one of them has a
 * real caller, which is why the count is four rather than seven.
 *
 * A first pass declared SEVEN, adding deleteSupportConversation,
 * clearSupportConversationMessages and uploadSupportAttachments. All three were
 * removed before merge: nothing in the widget called any of them, and two could
 * not have worked (see the note where their handlers used to live in
 * internal/api/v2/supportassistant/conversations.go). The manifest's `usedBy`
 * claimed the widget used all three, which is exactly the kind of entry this
 * file's count is meant to make somebody justify.
 *
 * `getSupportAssistantConfig` is counted in neither delta: it and its
 * `admin.getSupportAssistantConfig` entry both already existed, back when the
 * route was a static {"enabled": false} stub.
 *
 * 184 -> 186 when issue #440 wired the toolkit tool-discovery reads:
 * `toolkits.availableTools` and `toolkits.discoverTools`. Both are
 * handwritten, so GENERATED_OPERATION_COUNT is unchanged. The tripwire was
 * left at 184 by that change and this file was RED on the branch until
 * issue #528 measured it again — which is the tripwire doing its job, only
 * later than it should have been read.
 *
 * 157 -> 159, MANIFEST_ENTRY_COUNT unchanged, when the SAME two reads were
 * described in v2.yaml (listToolkitAvailableTools, discoverToolkitTools).
 * elitea-main's TestSpecRouterConformance/manifest_reverse_check demands a
 * spec entry for every endpoint the app calls, and #440 gave it two it could
 * not find. Describing them makes orval generate a hook for each, which is
 * the whole of this delta. The app still calls both through the hand-written
 * src/entities/toolkit/api/toolkitToolsApi.ts, so no manifest entry is added
 * and none changes source — the two existing entries only gain the
 * `operationId` the reverse check matches on.
 *
 * 159 -> 162, MANIFEST_ENTRY_COUNT 186 -> 189, when the stored
 * model-connection checks landed (checkStoredConfigurationConnection,
 * batchCheckStoredConfigurationConnections, revalidateConfiguration). The
 * same reverse-check pressure as the 157 -> 159 step: elitea-main's
 * conformance gate demanded spec coverage for the three endpoints the app
 * now calls, describing them makes orval generate a hook each, and the app
 * keeps calling through the hand-written
 * src/features/credentials/api/configurations.ts — so the three manifest
 * entries are handwritten, carrying operationIds for the reverse check.
 */
const GENERATED_OPERATION_COUNT = 162;
const MANIFEST_ENTRY_COUNT = 189;

describe('GREEN — the real, checked-in manifest', () => {
  it('exits 0 against src/shared/api/endpoints.manifest.json, unmodified', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--verbose'], { cwd: APP_ROOT, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('check-endpoint-manifest: OK');
    expect(result.stdout).toContain(`generated operations on disk: ${GENERATED_OPERATION_COUNT}`);
    expect(result.stdout).toContain(`manifest entries: ${MANIFEST_ENTRY_COUNT}`);
  });

  it('the same real manifest also passes as --json with ok:true', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: APP_ROOT, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.violations).toEqual([]);
    expect(parsed.duplicateIds).toEqual([]);
    expect(parsed.generatedOperationCount).toBe(GENERATED_OPERATION_COUNT);
    expect(parsed.totalEntries).toBe(MANIFEST_ENTRY_COUNT);
  });
});

describe('CLI surface', () => {
  it('--help exits 0 without touching any manifest', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('usage: check-endpoint-manifest.mjs');
  });

  it('an unknown flag exits 2', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--bogus-flag'], { encoding: 'utf8' });
    expect(result.status).toBe(2);
  });

  it('a missing/unreadable manifest path exits 2 with a clear message', () => {
    const result = run(join(tmpdir(), 'definitely-does-not-exist-s4.json'));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('cannot read/parse');
  });

  it('an empty generated set (bad --generated-dir) exits 2 rather than validating against nothing', () => {
    const dir = makeTempDir();
    const file = fixture(dir, 'ok.json', { version: 1, endpoints: [] });
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--manifest', file, '--generated-dir', join(dir, 'no-such-dir'), '--parity-dir', REAL_PARITY_DIR],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('found 0 generated operations');
  });

  it('tolerates a --parity-dir that does not exist (cross-reference just reports 0)', () => {
    const dir = makeTempDir();
    const file = fixture(dir, 'ok.json', { version: 1, endpoints: [] });
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--manifest', file, '--generated-dir', REAL_GENERATED_DIR, '--parity-dir', join(dir, 'no-such-parity-dir'), '--min-entries', '0'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('parity cross-reference 0/0');
  });
});
