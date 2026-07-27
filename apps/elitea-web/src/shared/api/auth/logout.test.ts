/**
 * Complete logout — §5.4 behaviour 7. The proof is the write-enumeration
 * mechanism: EVERY write made through the storage wrapper is tracked, and
 * after logout the write-set minus the cleared-set must be EMPTY — including
 * sessionStorage. A hardcoded key list could silently rot; this cannot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../../test/webstorage';

installWebStorageShim();

import {
  createStorage,
  disableStorageWriteTracking,
  enableStorageWriteTracking,
  trackedStorageWrites,
} from '../../lib/storage';

import { performLogout } from './logout';

afterEach(() => {
  disableStorageWriteTracking();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function storageFor(area: 'local' | 'session'): Storage {
  return area === 'local' ? window.localStorage : window.sessionStorage;
}

describe('performLogout', () => {
  it('write-set minus cleared-set is EMPTY — every el.* write in BOTH areas is gone', () => {
    enableStorageWriteTracking();
    const local = createStorage('local');
    const session = createStorage('session');

    // The exact state the OLD logout leaked (slices/user.js:24-27 cleared
    // only the two permission keys), mapped into the el.* namespace:
    local.set('project.id', '42'); //            was elitea_ui.project.id — leaked
    local.set('project.name', 'Demo'); //        was elitea_ui.project.name — leaked
    local.setJSON('mcp.tokens.v1', [{ server: 'a', token: 't' }]); // was elitea_mcp_tokens_v1 — leaked
    local.set('tour.chat.completed', '1'); //    tour keys — leaked
    local.set('mode', 'dark');
    // State-scoped auth-result fallbacks (LOW-4): the sweep must clear every
    // state without enumerating them.
    local.setJSON('auth.result.9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', { stale: true });
    local.setJSON('auth.result.11111111-2222-4333-8444-555555555555', { stale: true });
    session.set('project_permission', '["models.read"]'); // the two the old logout DID clear
    session.set('public_permission', '[]');
    session.set('auth.state', 'some-uuid');

    const writes = trackedStorageWrites();
    expect(writes.size).toBe(10);

    const redirect = vi.fn();
    performLogout({ redirect });

    const leaked = [...writes].filter((entry) => {
      const [area, underlyingKey] = entry.split(/:(.+)/, 2) as ['local' | 'session', string];
      return storageFor(area).getItem(underlyingKey) !== null;
    });
    expect(leaked).toEqual([]); // write-set − cleared-set = ∅
  });

  it('does not touch keys outside the el. namespace', () => {
    createStorage('local').set('project.id', '42');
    window.localStorage.setItem('other_app.pref', 'keep');
    window.sessionStorage.setItem('other_app.session', 'keep');
    performLogout({ redirect: vi.fn() });
    expect(window.localStorage.getItem('other_app.pref')).toBe('keep');
    expect(window.sessionStorage.getItem('other_app.session')).toBe('keep');
  });

  it('hands the browser to the backend logout (UserButton.jsx:32 parity)', () => {
    const redirect = vi.fn();
    performLogout({ redirect, origin: 'https://app.example' });
    expect(redirect).toHaveBeenCalledExactlyOnceWith('https://app.example/forward-auth/logout');
  });

  it('defaults the origin to the page origin', () => {
    const redirect = vi.fn();
    performLogout({ redirect });
    expect(redirect).toHaveBeenCalledExactlyOnceWith('http://localhost:3000/forward-auth/logout');
  });

  it('defaults the redirect to a window.location.href assignment', () => {
    // jsdom does not implement navigation; the assignment itself must not throw.
    expect(() => performLogout({ origin: 'http://localhost:3000' })).not.toThrow();
  });
});
