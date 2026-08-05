import { beforeEach, describe, expect, it } from 'vitest';

import { installWebStorageShim } from '@/test/webstorage';

installWebStorageShim();

import { readPersistedProject, writePersistedProject } from '../lib/selectedProjectPersistence';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('selectedProjectPersistence', () => {
  it('returns null when nothing is persisted', () => {
    expect(readPersistedProject()).toBeNull();
  });

  it('round-trips a persisted project under the el.project.* keys', () => {
    writePersistedProject({ id: '42', name: 'Acme' });
    expect(readPersistedProject()).toEqual({ id: '42', name: 'Acme' });
    expect(window.localStorage.getItem('el.project.id')).toBe('42');
    expect(window.localStorage.getItem('el.project.name')).toBe('Acme');
  });

  it('returns null when only one of the two keys is present (partial write)', () => {
    window.localStorage.setItem('el.project.id', '42');
    expect(readPersistedProject()).toBeNull();
  });

  // R7 regression: old app (`settings.js`'s `setProject` reducer/initial
  // state) writes to BOTH sessionStorage (checked first) and localStorage
  // — sessionStorage being per-tab lets two open tabs hold two different
  // selected projects independently.
  it('also writes the project to sessionStorage (per-tab layer), not just localStorage', () => {
    writePersistedProject({ id: '42', name: 'Acme' });
    expect(window.sessionStorage.getItem('el.project.id')).toBe('42');
    expect(window.sessionStorage.getItem('el.project.name')).toBe('Acme');
  });

  it('prefers a sessionStorage entry over a different localStorage entry (per-tab override)', () => {
    window.localStorage.setItem('el.project.id', '1');
    window.localStorage.setItem('el.project.name', 'Public');
    window.sessionStorage.setItem('el.project.id', '2');
    window.sessionStorage.setItem('el.project.name', 'Acme');

    expect(readPersistedProject()).toEqual({ id: '2', name: 'Acme' });
  });

  it('falls back to localStorage when sessionStorage has no (complete) entry of its own', () => {
    window.localStorage.setItem('el.project.id', '1');
    window.localStorage.setItem('el.project.name', 'Public');
    // A partial sessionStorage write (only one of the two keys) does not
    // count as "sessionStorage has its own selection" — same partial-write
    // rule as localStorage's, applied per-layer.
    window.sessionStorage.setItem('el.project.id', '2');

    expect(readPersistedProject()).toEqual({ id: '1', name: 'Public' });
  });

  it('a second (simulated) tab with its own sessionStorage sees its own selection, unaffected by another tab writing localStorage', () => {
    // Tab A selects a project — writes both areas.
    writePersistedProject({ id: '1', name: 'Public' });
    // Tab B (simulated: its own sessionStorage entry, distinct from Tab A's)
    // already has a different selection in its per-tab sessionStorage.
    window.sessionStorage.setItem('el.project.id', '2');
    window.sessionStorage.setItem('el.project.name', 'Acme');

    // Tab B still reads its own (sessionStorage) selection, not Tab A's
    // localStorage write.
    expect(readPersistedProject()).toEqual({ id: '2', name: 'Acme' });
  });
});
