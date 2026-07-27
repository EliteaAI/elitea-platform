/**
 * HTTP core — §5.4 behaviour 2 (real 401/403 + secondary redirect sniff),
 * behaviour 3 (single-flight re-auth) and byte-identical body replay.
 */
import { describe, expect, it } from 'vitest';

import { server } from '../../test/setup';
import {
  TRANSPORT_ECHO_PATH,
  TRANSPORT_PROBE_PATH,
  echoAuthGated,
  loginPage,
  probeAuthGated,
  probeRedirectGated,
  probeUnauthorizedThenNetworkError,
} from '../../test/msw/handlers/transport';
import type { CapturedRequest, SessionGate } from '../../test/msw/handlers/transport';

import { createHttpClient } from './http';
import type { HttpConfig } from './http';

const PROBE = TRANSPORT_PROBE_PATH.replace('/api/v2', '');
const ECHO = TRANSPORT_ECHO_PATH.replace('/api/v2', '');
const ORIGIN = window.location.origin;

/** Counting fake re-auth that restores the msw session gate on success. */
function fakeReauth(gate: SessionGate, opts: { fail?: boolean; delayMs?: number } = {}) {
  const state = { calls: 0 };
  const reauthenticate = (): Promise<void> =>
    new Promise((resolve, reject) => {
      state.calls += 1;
      const settle = (): void => {
        if (opts.fail === true) {
          reject(new Error('re-auth failed'));
          return;
        }
        gate.authed = true;
        resolve();
      };
      if (opts.delayMs === undefined) settle();
      else setTimeout(settle, opts.delayMs);
    });
  return { state, reauthenticate };
}

function client(reauthenticate?: HttpConfig['reauthenticate']) {
  return createHttpClient(
    reauthenticate === undefined ? { baseUrl: '/api/v2' } : { baseUrl: '/api/v2', reauthenticate },
  );
}

describe('behaviour 2 — real 401/403 is the PRIMARY re-auth signal', () => {
  it('a genuine 401 (auth.go:155 shape) triggers re-auth and the retry succeeds', async () => {
    const gate: SessionGate = { authed: false };
    const sink: CapturedRequest[] = [];
    server.use(probeAuthGated(gate, 401, sink));
    const { state, reauthenticate } = fakeReauth(gate);

    const result = await client(reauthenticate).get<{ message: string }>(PROBE);

    if (!result.ok) throw new Error('unreachable');
    expect(result.headers).toBeInstanceOf(Headers);
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { message: 'transport probe ok' },
      headers: result.headers,
    });
    expect(state.calls).toBe(1);
    expect(sink).toHaveLength(2); // original + retry
  });

  it('a 403 takes the same path (§5.4: 401/403 → re-auth flow)', async () => {
    const gate: SessionGate = { authed: false };
    server.use(probeAuthGated(gate, 403));
    const { state, reauthenticate } = fakeReauth(gate);
    const result = await client(reauthenticate).get(PROBE);
    expect(result.ok).toBe(true);
    expect(state.calls).toBe(1);
  });

  it('returns a kind:auth failure when no re-auth flow is configured', async () => {
    server.use(probeAuthGated({ authed: false }, 401));
    const result = await client().get(PROBE);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatchObject({ kind: 'auth', status: 401 });
  });

  it('returns a kind:auth failure when re-auth itself fails', async () => {
    const gate: SessionGate = { authed: false };
    server.use(probeAuthGated(gate, 401));
    const { state, reauthenticate } = fakeReauth(gate, { fail: true });
    const result = await client(reauthenticate).get(PROBE);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.kind).toBe('auth');
    expect(state.calls).toBe(1);
  });

  it('surfaces a retry that fails at the network level as a kind:network Result', async () => {
    server.use(probeUnauthorizedThenNetworkError());
    const reauthenticate = (): Promise<void> => Promise.resolve();
    const result = await client(reauthenticate).get(PROBE);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.kind).toBe('network');
  });

  it('gives up after ONE retry when the session is still denied', async () => {
    const gate: SessionGate = { authed: false };
    const sink: CapturedRequest[] = [];
    server.use(probeAuthGated(gate, 401, sink));
    // resolves but never restores the gate:
    let calls = 0;
    const reauthenticate = (): Promise<void> => {
      calls += 1;
      return Promise.resolve();
    };
    const result = await client(reauthenticate).get(PROBE);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.kind).toBe('auth');
    expect(calls).toBe(1);
    expect(sink).toHaveLength(2); // no retry loop
  });
});

describe('behaviour 2 — redirect sniff retained as the SECONDARY signal', () => {
  it('a redirect to a forward-auth login URL triggers re-auth (eliteaApi.js:26-28 parity)', async () => {
    const gate: SessionGate = { authed: false };
    server.use(
      probeRedirectGated(gate, `${ORIGIN}/forward-auth/auth_oidc/login?target_to=abc`),
      loginPage('/forward-auth/auth_oidc/login'),
    );
    const { state, reauthenticate } = fakeReauth(gate);
    const result = await client(reauthenticate).get<{ message: string }>(PROBE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data).toEqual({ message: 'transport probe ok' });
    expect(state.calls).toBe(1);
  });

  it('ignores a forward-auth redirect that is not a login page', async () => {
    const gate: SessionGate = { authed: false };
    server.use(
      // `/login` appears ONLY inside the target_to VALUE (raw slash survives
      // URL serialization) — the sniff must strip the param before matching:
      probeRedirectGated(gate, `${ORIGIN}/forward-auth/dashboard?target_to=/login`),
      loginPage('/forward-auth/dashboard'),
    );
    const { state, reauthenticate } = fakeReauth(gate);
    const result = await client(reauthenticate).get(PROBE);
    expect(result.ok).toBe(true); // followed content is returned as-is
    expect(state.calls).toBe(0);
  });

  it('ignores a login-looking redirect outside forward-auth', async () => {
    const gate: SessionGate = { authed: false };
    server.use(
      probeRedirectGated(gate, `${ORIGIN}/elsewhere/login`),
      loginPage('/elsewhere/login'),
    );
    const { state, reauthenticate } = fakeReauth(gate);
    const result = await client(reauthenticate).get(PROBE);
    expect(result.ok).toBe(true);
    expect(state.calls).toBe(0);
  });
});

describe('behaviour 3 — single-flight re-auth', () => {
  it('3 concurrent 401s trigger exactly ONE re-auth; queued requests retry after it settles', async () => {
    const gate: SessionGate = { authed: false };
    server.use(probeAuthGated(gate, 401));
    const { state, reauthenticate } = fakeReauth(gate, { delayMs: 25 });
    const shared = client(reauthenticate);

    const results = await Promise.all([shared.get(PROBE), shared.get(PROBE), shared.get(PROBE)]);

    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    expect(state.calls).toBe(1);
  });

  it('a LATER 401 burst starts a fresh flight (the guard clears on settle)', async () => {
    const gate: SessionGate = { authed: false };
    server.use(probeAuthGated(gate, 401));
    const { state, reauthenticate } = fakeReauth(gate);
    const shared = client(reauthenticate);
    expect((await shared.get(PROBE)).ok).toBe(true);
    gate.authed = false; // session expires again
    expect((await shared.get(PROBE)).ok).toBe(true);
    expect(state.calls).toBe(2);
  });

  it('an abort during the re-auth wait skips the retry', async () => {
    const gate: SessionGate = { authed: false };
    server.use(probeAuthGated(gate, 401));
    const deferred = { held: false, release: (): void => {} };
    const reauthenticate = (): Promise<void> =>
      new Promise<void>((resolve) => {
        deferred.release = () => {
          gate.authed = true;
          resolve();
        };
        deferred.held = true;
      });
    const controller = new AbortController();
    const pending = client(reauthenticate).get(PROBE, { signal: controller.signal });
    // wait until the re-auth flow is holding the request
    while (!deferred.held) await new Promise((r) => setTimeout(r, 1));
    controller.abort();
    deferred.release();
    const result = await pending;
    if (result.ok) throw new Error('expected abort');
    expect(result.error.kind).toBe('aborted');
  });
});

describe('replayability — the post-re-auth retry is byte-identical', () => {
  it('replays the exact same body bytes after re-auth (old app pre-cloned, eliteaApi.js:17-18)', async () => {
    const gate: SessionGate = { authed: false };
    const sink: CapturedRequest[] = [];
    server.use(echoAuthGated(gate, sink));
    const { state, reauthenticate } = fakeReauth(gate);

    const body = { q: 'söme β bytes', nested: { list: [1, 2, 3] } };
    const result = await client(reauthenticate).post<{ received: boolean }>(ECHO, { body });

    if (!result.ok) throw new Error('unreachable');
    expect(result.headers).toBeInstanceOf(Headers);
    expect(result).toEqual({ ok: true, status: 200, data: { received: true }, headers: result.headers });
    expect(state.calls).toBe(1);
    expect(sink).toHaveLength(2);
    expect(sink[0]?.bodyText).toBe(sink[1]?.bodyText); // byte-identical replay
    expect(JSON.parse(sink[1]?.bodyText ?? '')).toEqual(body);
  });
});
