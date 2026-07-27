/**
 * verifySession endpoint binding (§5.4 behaviour 5): the auth/me-class GET is
 * `/social/author/` — old SPA `authorDetails` (social.js:120-123), Go handler
 * v2/social/handler.go:24 behind the auth middleware whose genuine 401 is
 * auth.go:155. See verify-session.ts for the full evidence trail.
 */
import { describe, expect, it } from 'vitest';

import { server } from '../../../test/setup';
import { AUTHOR_PATH, authorGated } from '../../../test/msw/handlers/transport';
import type { CapturedRequest, SessionGate } from '../../../test/msw/handlers/transport';

import { createHttpClient } from '../http';

import { VERIFY_SESSION_PATH, createVerifySession } from './verify-session';

// Deliberately built WITHOUT `reauthenticate` — a 401 during the probe must
// report failure, never open another popup (see verify-session.ts JSDoc).
const probeClient = () => createHttpClient({ baseUrl: '/api/v2' });

describe('createVerifySession', () => {
  it('binds to GET /api/v2/social/author/ and confirms a live session', async () => {
    const gate: SessionGate = { authed: true };
    const sink: CapturedRequest[] = [];
    server.use(authorGated(gate, sink));

    const verifySession = createVerifySession(probeClient());
    await expect(verifySession()).resolves.toBe(true);

    expect(VERIFY_SESSION_PATH).toBe('/social/author/');
    expect(sink[0]?.method).toBe('GET');
    expect(sink[0]?.url).toBe(`http://localhost:3000${AUTHOR_PATH}`);
    expect(AUTHOR_PATH).toBe('/api/v2/social/author/');
  });

  it('reports false on the genuine 401 shape (auth.go:155) instead of guessing success', async () => {
    const gate: SessionGate = { authed: false };
    server.use(authorGated(gate));
    const verifySession = createVerifySession(probeClient());
    await expect(verifySession()).resolves.toBe(false);
  });

  it('REFUSES a re-auth-capable client — a popup inside the callback popup would loop', () => {
    const reauthClient = createHttpClient({
      baseUrl: '/api/v2',
      reauthenticate: () => Promise.resolve(),
    });
    expect(reauthClient.reauthConfigured).toBe(true);
    expect(() => createVerifySession(reauthClient)).toThrow(/without reauthenticate/i);
  });

  it('accepts a client with no re-auth flow', () => {
    expect(probeClient().reauthConfigured).toBe(false);
    expect(() => createVerifySession(probeClient())).not.toThrow();
  });
});
