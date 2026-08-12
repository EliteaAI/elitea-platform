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

function run(manifestPath, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [SCRIPT, '--manifest', manifestPath, '--generated-dir', REAL_GENERATED_DIR, '--parity-dir', REAL_PARITY_DIR, ...extraArgs],
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
 * in v2.yaml alongside internal/api/v2/social/current_avatar.go. Neither is
 * in the endpoint manifest yet (it stays handwritten, not yet landed, same
 * as most P1 API-* items), so MANIFEST_ENTRY_COUNT is unchanged.
 */
const GENERATED_OPERATION_COUNT = 106;
const MANIFEST_ENTRY_COUNT = 179;

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
      [SCRIPT, '--manifest', file, '--generated-dir', REAL_GENERATED_DIR, '--parity-dir', join(dir, 'no-such-parity-dir')],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('parity cross-reference 0/0');
  });
});
