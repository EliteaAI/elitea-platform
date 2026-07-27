import { beforeEach, describe, expect, it } from 'vitest';

import { installWebStorageShim } from '@/test/webstorage';

installWebStorageShim();

import { readPersistedProject, writePersistedProject } from '../lib/selectedProjectPersistence';

beforeEach(() => {
  window.localStorage.clear();
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
});
