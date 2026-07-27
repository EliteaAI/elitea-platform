/**
 * shared/lib/storage — the `el.` namespace wrapper (spec §5.4).
 * Raw localStorage/sessionStorage access here is the test-side of the fence
 * (the F2 oxlint override relaxes `no-restricted-globals` for tests).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../test/webstorage';

installWebStorageShim();

import {
  STORAGE_NAMESPACE,
  clearNamespace,
  createStorage,
  disableStorageWriteTracking,
  enableStorageWriteTracking,
  trackedStorageWrites,
} from './storage';

afterEach(() => {
  disableStorageWriteTracking();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('namespacing', () => {
  it('prefixes every write with `el.`', () => {
    createStorage('local').set('project.id', '42');
    expect(window.localStorage.getItem('el.project.id')).toBe('42');
    expect(window.localStorage.getItem('project.id')).toBeNull();
  });

  it('reads back through the same prefix and reports logical keys', () => {
    const local = createStorage('local');
    local.set('project.id', '42');
    local.set('project.name', 'Demo');
    window.localStorage.setItem('foreign.key', 'not-ours');
    expect(local.get('project.id')).toBe('42');
    expect(local.keys().sort()).toEqual(['project.id', 'project.name']);
  });

  it('keeps the two areas separate', () => {
    createStorage('local').set('mode', 'dark');
    expect(createStorage('session').get('mode')).toBeNull();
    expect(window.sessionStorage.getItem('el.mode')).toBeNull();
  });

  it('remove deletes only the namespaced key', () => {
    const local = createStorage('local');
    local.set('mode', 'dark');
    window.localStorage.setItem('mode', 'foreign');
    local.remove('mode');
    expect(window.localStorage.getItem('el.mode')).toBeNull();
    expect(window.localStorage.getItem('mode')).toBe('foreign');
  });
});

describe('typed JSON access', () => {
  it('round-trips JSON values', () => {
    const local = createStorage('local');
    local.setJSON('tokens', { v: 1, items: ['a'] });
    expect(local.getJSON('tokens')).toEqual({ v: 1, items: ['a'] });
  });

  it('returns null for absent keys', () => {
    expect(createStorage('local').getJSON('missing')).toBeNull();
  });

  it('treats malformed JSON as absent instead of throwing (§3.6)', () => {
    window.localStorage.setItem('el.corrupt', '{not json');
    expect(createStorage('local').getJSON('corrupt')).toBeNull();
  });

  it('applies the validate function and treats rejection as absent', () => {
    const local = createStorage('local');
    local.setJSON('n', 7);
    const asNumber = (raw: unknown): number => {
      if (typeof raw !== 'number') throw new Error('not a number');
      return raw;
    };
    expect(local.getJSON('n', asNumber)).toBe(7);
    local.setJSON('n', 'seven');
    expect(local.getJSON('n', asNumber)).toBeNull();
  });

  it('treats a validate function returning undefined as rejection', () => {
    const local = createStorage('local');
    local.setJSON('flag', true);
    expect(local.getJSON('flag', (raw) => (raw === false ? raw : undefined))).toBeNull();
  });
});

describe('clearNamespace (§5.4 complete logout)', () => {
  it('removes every el.* key from BOTH areas and nothing else', () => {
    const local = createStorage('local');
    const session = createStorage('session');
    local.set('project.id', '42');
    local.set('mcp.tokens.v1', '[]');
    session.set('auth.state', 'abc');
    window.localStorage.setItem('other_app.key', 'keep');
    window.sessionStorage.setItem('other_app.session', 'keep');

    clearNamespace();

    expect(local.keys()).toEqual([]);
    expect(session.keys()).toEqual([]);
    expect(window.localStorage.getItem('other_app.key')).toBe('keep');
    expect(window.sessionStorage.getItem('other_app.session')).toBe('keep');
  });
});

describe('write enumeration (§5.4 test-mode wrapped Storage)', () => {
  it('enumerates every write made through the wrapper, across areas', () => {
    enableStorageWriteTracking();
    createStorage('local').set('a', '1');
    createStorage('local').setJSON('b', 2);
    createStorage('session').set('c', '3');
    expect(trackedStorageWrites()).toEqual(
      new Set([`local:${STORAGE_NAMESPACE}a`, `local:${STORAGE_NAMESPACE}b`, `session:${STORAGE_NAMESPACE}c`]),
    );
  });

  it('records nothing while disabled and survives double-enable', () => {
    createStorage('local').set('untracked', 'x');
    expect(trackedStorageWrites().size).toBe(0);
    enableStorageWriteTracking();
    createStorage('local').set('tracked', 'y');
    enableStorageWriteTracking(); // idempotent — must not wipe the log
    expect(trackedStorageWrites()).toEqual(new Set([`local:${STORAGE_NAMESPACE}tracked`]));
    disableStorageWriteTracking();
    expect(trackedStorageWrites().size).toBe(0);
  });

  it('refuses to enable tracking outside dev/test builds', () => {
    vi.stubEnv('DEV', false);
    try {
      expect(() => enableStorageWriteTracking()).toThrow(/dev\/test mechanism/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
