/**
 * The session store is what turns the server-side OIDC cookie into the
 * RouterContext `auth` object every route guard reads, so an undetected
 * regression here logs every user out (or, worse, logs them in as nobody).
 *
 * These tests construct isolated instances via `createSessionStore()` rather
 * than touching the module singleton — that is the reason the factory is
 * exported (same rationale as `createNavBlockerStore`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import { writePersistedProject } from '@/widgets/app-shell';

import { server } from '../test/setup';

import { createSessionStore, sessionAuthContext, useSessionStore } from './session-store';

const INFO = '/forward-auth/info';

describe('createSessionStore', () => {
  it('starts with no user and loaded=false before any probe', () => {
    const store = createSessionStore();
    expect(store.getState().user).toBeUndefined();
    expect(store.getState().loaded).toBe(false);
  });

  it('populates the user from an authenticated /forward-auth/info response', async () => {
    server.use(
      http.get(INFO, () => HttpResponse.json({ authenticated: true, user_id: 'u-42' })),
    );
    const store = createSessionStore();
    await store.getState().fetchSession();

    expect(store.getState().user).toEqual({ id: 'u-42', personal_project_id: 'u-42' });
    expect(store.getState().loaded).toBe(true);
  });

  it('sends the session cookie — the probe is worthless without credentials', async () => {
    let credentialsSeen: string | undefined;
    server.use(
      http.get(INFO, ({ request }) => {
        credentialsSeen = request.credentials;
        return HttpResponse.json({ authenticated: true, user_id: 'u-1' });
      }),
    );
    const store = createSessionStore();
    await store.getState().fetchSession();

    expect(credentialsSeen).not.toBe('omit');
  });

  it('leaves the user undefined when the session is not authenticated', async () => {
    // `user_id` is deliberately present: a body carrying a subject but
    // `authenticated: false` is the shape that proves the `authenticated`
    // check is doing work, rather than the `user_id` check catching it.
    server.use(
      http.get(INFO, () => HttpResponse.json({ authenticated: false, user_id: 'u-9' })),
    );
    const store = createSessionStore();
    await store.getState().fetchSession();

    expect(store.getState().user).toBeUndefined();
    expect(store.getState().loaded).toBe(true);
  });

  it('leaves the user undefined when authenticated=true carries no user_id', async () => {
    // A session with no subject must not produce a user whose id is undefined:
    // the index-route guard would read it as "logged in" and skip the redirect.
    server.use(http.get(INFO, () => HttpResponse.json({ authenticated: true })));
    const store = createSessionStore();
    await store.getState().fetchSession();

    expect(store.getState().user).toBeUndefined();
    expect(store.getState().loaded).toBe(true);
  });

  it('treats a 401 as "not logged in" and still resolves loaded=true', async () => {
    server.use(http.get(INFO, () => new HttpResponse(null, { status: 401 })));
    const store = createSessionStore();
    await store.getState().fetchSession();

    expect(store.getState().user).toBeUndefined();
    expect(store.getState().loaded).toBe(true);
  });

  it('does not reject when the probe fails at the network level', async () => {
    server.use(http.get(INFO, () => HttpResponse.error()));
    const store = createSessionStore();

    // A rejection here would escape App.tsx's mount effect as an unhandled
    // rejection and leave `loaded` false forever, hanging the router.
    await expect(store.getState().fetchSession()).resolves.toBeUndefined();
    expect(store.getState().user).toBeUndefined();
    expect(store.getState().loaded).toBe(true);
  });

  it('gives each instance its own state', async () => {
    server.use(
      http.get(INFO, () => HttpResponse.json({ authenticated: true, user_id: 'u-7' })),
    );
    const a = createSessionStore();
    const b = createSessionStore();
    await a.getState().fetchSession();

    expect(a.getState().user?.id).toBe('u-7');
    expect(b.getState().user).toBeUndefined();
  });
});

/**
 * `sessionAuthContext.getSelectedProjectId` is the seam every
 * `useSelectedProjectId` duplicate reads and every project-scoped query is
 * gated on. It returned a hardcoded `undefined`, so those queries never ran
 * and `EditApplication` could not load an agent at all — a deep link
 * cold-loaded to an empty page (JRNY-005).
 */
describe('sessionAuthContext.getSelectedProjectId', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useSessionStore.setState({ user: undefined });
  });

  it('resolves the persisted selected project', () => {
    writePersistedProject({ id: '42', name: 'Default Project' });
    expect(sessionAuthContext.getSelectedProjectId()).toBe('42');
  });

  it('prefers the per-tab session selection over the local one', () => {
    writePersistedProject({ id: '7', name: 'Local' });
    sessionStorage.setItem('el.project.id', '9');
    sessionStorage.setItem('el.project.name', 'This Tab');
    expect(sessionAuthContext.getSelectedProjectId()).toBe('9');
  });

  it('defers with undefined when nothing is selected but a personal project exists', () => {
    useSessionStore.setState({ user: { id: 'u-1', personal_project_id: 'p-1' } });
    expect(sessionAuthContext.getSelectedProjectId()).toBeUndefined();
  });

  it("returns '' when there is no project context at all", () => {
    useSessionStore.setState({ user: { id: 'u-1' } });
    expect(sessionAuthContext.getSelectedProjectId()).toBe('');
  });
});
