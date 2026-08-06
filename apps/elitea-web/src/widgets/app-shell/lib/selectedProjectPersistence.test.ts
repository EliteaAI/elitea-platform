import { afterEach, describe, expect, it } from 'vitest';

import { installWebStorageShim } from '@/test/webstorage';

import { readPersistedProject, writePersistedProject } from './selectedProjectPersistence';

installWebStorageShim();

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('writePersistedProject', () => {
  it('writes to both sessionStorage and localStorage', () => {
    writePersistedProject({ id: '42', name: 'Test' });
    expect(window.sessionStorage.getItem('el.project.id')).toBe('42');
    expect(window.sessionStorage.getItem('el.project.name')).toBe('Test');
    expect(window.localStorage.getItem('el.project.id')).toBe('42');
    expect(window.localStorage.getItem('el.project.name')).toBe('Test');
  });
});

describe('readPersistedProject', () => {
  it('returns null when neither storage has data', () => {
    expect(readPersistedProject()).toBeNull();
  });

  it('reads from sessionStorage first', () => {
    window.sessionStorage.setItem('el.project.id', 'session-1');
    window.sessionStorage.setItem('el.project.name', 'SessionProj');
    window.localStorage.setItem('el.project.id', 'local-1');
    window.localStorage.setItem('el.project.name', 'LocalProj');
    expect(readPersistedProject()).toEqual({ id: 'session-1', name: 'SessionProj' });
  });

  it('falls back to localStorage when session is incomplete', () => {
    window.sessionStorage.setItem('el.project.id', 'only-id');
    window.localStorage.setItem('el.project.id', 'l1');
    window.localStorage.setItem('el.project.name', 'LocalName');
    expect(readPersistedProject()).toEqual({ id: 'l1', name: 'LocalName' });
  });

  it('returns null when only partial data in local', () => {
    window.localStorage.setItem('el.project.id', 'partial');
    expect(readPersistedProject()).toBeNull();
  });

  it('roundtrips through write then read', () => {
    writePersistedProject({ id: '99', name: 'RoundTrip' });
    expect(readPersistedProject()).toEqual({ id: '99', name: 'RoundTrip' });
  });
});
