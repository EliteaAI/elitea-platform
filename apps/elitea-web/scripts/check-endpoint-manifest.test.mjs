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

describe('GREEN — the real, checked-in manifest', () => {
  it('exits 0 against src/shared/api/endpoints.manifest.json, unmodified', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--verbose'], { cwd: APP_ROOT, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('check-endpoint-manifest: OK');
    expect(result.stdout).toContain('generated operations on disk: 92');
    expect(result.stdout).toContain('manifest entries: 121');
  });

  it('the same real manifest also passes as --json with ok:true', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: APP_ROOT, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.violations).toEqual([]);
    expect(parsed.duplicateIds).toEqual([]);
    expect(parsed.generatedOperationCount).toBe(92);
    expect(parsed.totalEntries).toBe(121);
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
