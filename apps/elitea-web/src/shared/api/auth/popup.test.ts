/**
 * Auth popup controller — §5.4 behaviour 4 (crypto.randomUUID state, verified
 * on delivery) + the controller-level single-flight and delivery channels.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../../test/webstorage';

installWebStorageShim();

import { sendAuthResult } from './callback';
import type { AuthChannelLike } from './channel';
import { AUTH_MESSAGE_TYPE } from './constants';
import { AuthPopupError, createAuthPopupController } from './popup';
import type { AuthPopupOptions, PopupWindowLike } from './popup';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class FakeChannel implements AuthChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sent: unknown[] = [];
  readonly name: string;
  closed = false;
  constructor(name: string) {
    this.name = name;
  }
  postMessage(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
}

interface Harness {
  controller: ReturnType<typeof createAuthPopupController>;
  openedUrls: string[];
  openedFeatures: string[];
  channels: FakeChannel[];
  popup: PopupWindowLike & { closed: boolean };
  stateOf(index?: number): string;
}

function harness(overrides: Partial<AuthPopupOptions> = {}): Harness {
  const openedUrls: string[] = [];
  const openedFeatures: string[] = [];
  const channels: FakeChannel[] = [];
  const popup = { closed: false, close: (): void => undefined };
  const controller = createAuthPopupController({
    openWindow: (url, _name, features) => {
      openedUrls.push(url);
      openedFeatures.push(features);
      return popup;
    },
    createChannel: (name) => {
      const channel = new FakeChannel(name);
      channels.push(channel);
      return channel;
    },
    ...overrides,
  });
  return {
    controller,
    openedUrls,
    openedFeatures,
    channels,
    popup,
    stateOf(index = 0) {
      const url = openedUrls[index];
      if (url === undefined) throw new Error(`no popup ${index} opened`);
      const state = new URL(url).searchParams.get('auth_state');
      if (state === null) throw new Error('no auth_state in popup URL');
      return state;
    },
  };
}

function resultMessage(state: string, success = true): unknown {
  return { type: AUTH_MESSAGE_TYPE, state, success };
}

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  const flagged = promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  await Promise.race([flagged, new Promise((r) => setTimeout(r, 5))]);
  return done;
}

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('behaviour 4 — crypto.randomUUID state', () => {
  it('uses a UUID for the popup state and persists it under el.auth.state', async () => {
    const h = harness();
    const flight = h.controller.reauthenticate();
    const state = h.stateOf();
    expect(state).toMatch(UUID_V4); // the old Math.random+Date state can never match
    expect(window.sessionStorage.getItem('el.auth.state')).toBe(state);

    h.channels[0]?.onmessage?.({ data: resultMessage(state) });
    await flight;
  });

  it('generates a distinct state per flight', async () => {
    const h = harness();
    const first = h.controller.reauthenticate();
    h.channels[0]?.onmessage?.({ data: resultMessage(h.stateOf(0)) });
    await first;
    const second = h.controller.reauthenticate();
    h.channels[1]?.onmessage?.({ data: resultMessage(h.stateOf(1)) });
    await second;
    expect(h.stateOf(0)).not.toBe(h.stateOf(1));
  });

  it('builds the callback URL from baseOrigin + basePath (ROUTE-001)', async () => {
    const h = harness({ baseOrigin: 'https://backend.example', basePath: '/elitea_ui' });
    const flight = h.controller.reauthenticate();
    const url = h.openedUrls[0] ?? '';
    expect(url).toBe(`https://backend.example/elitea_ui/auth-callback?auth_state=${h.stateOf()}`);
    expect(h.openedFeatures[0]).toContain('width=500,height=600'); // clamped minimums
    h.channels[0]?.onmessage?.({ data: resultMessage(h.stateOf()) });
    await flight;
  });
});

describe('state verification on delivery', () => {
  it('ignores results carrying the wrong state, then accepts the right one', async () => {
    const h = harness();
    const flight = h.controller.reauthenticate();
    h.channels[0]?.onmessage?.({ data: resultMessage('11111111-2222-4333-8444-555555555555') });
    expect(await settled(flight)).toBe(false); // still pending — wrong state ignored
    h.channels[0]?.onmessage?.({ data: resultMessage(h.stateOf()) });
    await flight;
  });

  it('ignores malformed messages', async () => {
    const h = harness();
    const flight = h.controller.reauthenticate();
    h.channels[0]?.onmessage?.({ data: { type: 'something-else' } });
    h.channels[0]?.onmessage?.({ data: null });
    expect(await settled(flight)).toBe(false);
    h.channels[0]?.onmessage?.({ data: resultMessage(h.stateOf()) });
    await flight;
  });

  it('rejects with auth_failed on a success:false result', async () => {
    const h = harness();
    const flight = h.controller.reauthenticate();
    h.channels[0]?.onmessage?.({ data: resultMessage(h.stateOf(), false) });
    await expect(flight).rejects.toMatchObject({ name: 'AuthPopupError', reason: 'auth_failed' });
  });
});

describe('delivery channels', () => {
  it('accepts a window postMessage from the page origin only', async () => {
    const h = harness();
    const flight = h.controller.reauthenticate();
    window.dispatchEvent(
      new MessageEvent('message', { data: resultMessage(h.stateOf()), origin: 'https://evil.example' }),
    );
    expect(await settled(flight)).toBe(false);
    window.dispatchEvent(
      new MessageEvent('message', { data: resultMessage(h.stateOf()), origin: window.location.origin }),
    );
    await flight;
  });

  it('scopes the BroadcastChannel to the flight state', async () => {
    const h = harness();
    const flight = h.controller.reauthenticate();
    expect(h.channels[0]?.name).toBe(`elitea-auth-${h.stateOf()}`);
    h.channels[0]?.onmessage?.({ data: resultMessage(h.stateOf()) });
    await flight;
    expect(h.channels[0]?.closed).toBe(true);
  });

  it('consumes the localStorage fallback via the poll and removes the key', async () => {
    vi.useFakeTimers();
    const h = harness();
    const flight = h.controller.reauthenticate();
    const key = `el.auth.result.${h.stateOf()}`;
    window.localStorage.setItem(key, JSON.stringify(resultMessage(h.stateOf())));
    await vi.advanceTimersByTimeAsync(300);
    await flight;
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('consumes the localStorage fallback on a storage event without waiting for the poll', async () => {
    const h = harness();
    const flight = h.controller.reauthenticate();
    const key = `el.auth.result.${h.stateOf()}`;
    window.localStorage.setItem(key, JSON.stringify(resultMessage(h.stateOf())));
    window.dispatchEvent(new StorageEvent('storage', { key }));
    await flight;
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('two concurrent controllers cannot consume each other’s fallback result', async () => {
    // Two tabs mid-re-auth. With ONE shared fallback key the loser reads the
    // winner's result, discards it on state mismatch AND deletes it — so the
    // rightful owner hangs to popup_closed. The key is state-scoped instead.
    const tabA = harness();
    const tabB = harness();
    const flightA = tabA.controller.reauthenticate();
    const flightB = tabB.controller.reauthenticate();
    expect(tabA.stateOf()).not.toBe(tabB.stateOf());

    // B's callback page reports its result through the REAL writer.
    sendAuthResult(
      { type: AUTH_MESSAGE_TYPE, state: tabB.stateOf(), success: true },
      { opener: null, createChannel: () => null }, // force the localStorage path
    );
    window.dispatchEvent(new StorageEvent('storage', { key: `el.auth.result.${tabB.stateOf()}` }));

    await expect(flightB).resolves.toBeUndefined();
    expect(await settled(flightA)).toBe(false); // A untouched, still waiting
    expect(window.localStorage.getItem(`el.auth.result.${tabB.stateOf()}`)).toBeNull();

    // A then completes on its own state, proving it was never poisoned.
    tabA.channels[0]?.onmessage?.({ data: resultMessage(tabA.stateOf()) });
    await expect(flightA).resolves.toBeUndefined();
  });
});

describe('single-flight + lifecycle', () => {
  it('returns the SAME promise while a flight is pending and opens one popup', async () => {
    const h = harness();
    const first = h.controller.reauthenticate();
    const second = h.controller.reauthenticate();
    expect(second).toBe(first);
    expect(h.controller.pending).toBe(true);
    expect(h.openedUrls).toHaveLength(1);
    h.channels[0]?.onmessage?.({ data: resultMessage(h.stateOf()) });
    await first;
    expect(h.controller.pending).toBe(false);
  });

  it('cleans up state storage and starts a fresh flight after settle', async () => {
    const h = harness();
    const first = h.controller.reauthenticate();
    h.channels[0]?.onmessage?.({ data: resultMessage(h.stateOf(0)) });
    await first;
    expect(window.sessionStorage.getItem('el.auth.state')).toBeNull();
    const second = h.controller.reauthenticate();
    expect(h.openedUrls).toHaveLength(2);
    h.channels[1]?.onmessage?.({ data: resultMessage(h.stateOf(1)) });
    await second;
  });

  it('rejects popup_blocked when the popup cannot open (default window.open + BroadcastChannel path)', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null); // browser-API spy, not an app-module mock
    const controller = createAuthPopupController(); // real defaults on purpose
    await expect(controller.reauthenticate()).rejects.toMatchObject({ reason: 'popup_blocked' });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('el.auth.state')).toBeNull();
    // A blocked popup must NOT poison the controller: the flight slot has to
    // be empty again. Re-auth fires from a background 401, i.e. without user
    // activation — precisely when browsers block window.open — so a stuck
    // slot would kill re-auth for the whole page lifetime.
    expect(controller.pending).toBe(false);
    openSpy.mockRestore();
  });

  it('a blocked popup does not poison the controller — the NEXT call opens a window again', async () => {
    const h = harness({
      openWindow: (url, _name, features) => {
        h.openedUrls.push(url);
        h.openedFeatures.push(features);
        return null; // browser blocks it: no user activation behind a background 401
      },
    });
    await expect(h.controller.reauthenticate()).rejects.toMatchObject({ reason: 'popup_blocked' });
    expect(h.controller.pending).toBe(false);

    // Still blocked: every attempt must reach window.open rather than
    // short-circuit on a stale rejected promise parked in the flight slot.
    await expect(h.controller.reauthenticate()).rejects.toMatchObject({ reason: 'popup_blocked' });
    await expect(h.controller.reauthenticate()).rejects.toMatchObject({ reason: 'popup_blocked' });
    expect(h.openedUrls).toHaveLength(3);
  });

  it('recovers once the user unblocks popups — a later flight opens and succeeds', async () => {
    let blocked = true;
    const h = harness({
      openWindow: (url, _name, features) => {
        h.openedUrls.push(url);
        h.openedFeatures.push(features);
        return blocked ? null : h.popup;
      },
    });
    await expect(h.controller.reauthenticate()).rejects.toMatchObject({ reason: 'popup_blocked' });

    blocked = false; // user allows popups for this site
    const flight = h.controller.reauthenticate();
    expect(h.openedUrls).toHaveLength(2);
    expect(h.controller.pending).toBe(true);
    h.channels[1]?.onmessage?.({ data: resultMessage(h.stateOf(1)) }); // flight 2's own channel
    await expect(flight).resolves.toBeUndefined();
    expect(h.controller.pending).toBe(false);
  });

  it('rejects popup_closed when the user closes the popup', async () => {
    vi.useFakeTimers();
    const h = harness();
    const flight = h.controller.reauthenticate();
    h.popup.closed = true;
    const expectation = expect(flight).rejects.toBeInstanceOf(AuthPopupError);
    await vi.advanceTimersByTimeAsync(300);
    await expectation;
    expect(h.controller.pending).toBe(false);
  });
});
