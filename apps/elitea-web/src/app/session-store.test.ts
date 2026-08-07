/**
 * The session store is what turns the server-side OIDC cookie into the
 * RouterContext `auth` object every route guard reads, so an undetected
 * regression here logs every user out (or, worse, logs them in as nobody).
 *
 * These tests construct isolated instances via `createSessionStore()` rather
 * than touching the module singleton — that is the reason the factory is
 * exported (same rationale as `createNavBlockerStore`).
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../test/setup';

import { createSessionStore } from './session-store';

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
