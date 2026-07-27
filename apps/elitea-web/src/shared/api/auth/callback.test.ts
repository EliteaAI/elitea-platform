/**
 * Auth callback — §5.4 behaviour 5: a session must actually EXIST before
 * success is posted (the old page posted success unconditionally,
 * pages/auth/index.jsx:42-46).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWebStorageShim } from '../../../test/webstorage';

installWebStorageShim();

import type { AuthChannelLike } from './channel';
import { AUTH_MESSAGE_TYPE } from './constants';
import type { AuthResultMessage } from './constants';
import { completeAuthCallback, sendAuthResult } from './callback';

const STATE = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('completeAuthCallback', () => {
  it('reports missing_state and posts NOTHING when auth_state is absent', async () => {
    const post = vi.fn();
    const verifySession = vi.fn();
    const outcome = await completeAuthCallback({ search: '?foo=bar', verifySession, postResult: post });
    expect(outcome).toEqual({ status: 'error', reason: 'missing_state' });
    expect(post).not.toHaveBeenCalled();
    expect(verifySession).not.toHaveBeenCalled();
  });

  it('posts success ONLY after verifySession confirms a session exists', async () => {
    const post = vi.fn();
    const outcome = await completeAuthCallback({
      search: `?auth_state=${STATE}`,
      verifySession: () => Promise.resolve(true),
      postResult: post,
    });
    expect(outcome).toEqual({ status: 'success' });
    expect(post).toHaveBeenCalledExactlyOnceWith({ type: AUTH_MESSAGE_TYPE, state: STATE, success: true });
  });

  it('posts FAILURE when the session probe says there is no session', async () => {
    const post = vi.fn();
    const outcome = await completeAuthCallback({
      search: `?auth_state=${STATE}`,
      verifySession: () => Promise.resolve(false),
      postResult: post,
    });
    expect(outcome).toEqual({ status: 'error', reason: 'session_invalid' });
    expect(post).toHaveBeenCalledExactlyOnceWith({ type: AUTH_MESSAGE_TYPE, state: STATE, success: false });
  });

  it('treats a throwing probe as no-session and still posts failure (§3.6 handled)', async () => {
    const post = vi.fn();
    const outcome = await completeAuthCallback({
      search: `?auth_state=${STATE}`,
      verifySession: () => Promise.reject(new Error('probe exploded')),
      postResult: post,
    });
    expect(outcome).toEqual({ status: 'error', reason: 'verify_failed' });
    expect(post).toHaveBeenCalledExactlyOnceWith({ type: AUTH_MESSAGE_TYPE, state: STATE, success: false });
  });

  it('defaults postResult to sendAuthResult (localStorage fallback observable)', async () => {
    const outcome = await completeAuthCallback({
      search: `?auth_state=${STATE}`,
      verifySession: () => Promise.resolve(true),
    });
    expect(outcome).toEqual({ status: 'success' });
    const stored = JSON.parse(window.localStorage.getItem(`el.auth.result.${STATE}`) ?? 'null') as unknown;
    expect(stored).toEqual({ type: AUTH_MESSAGE_TYPE, state: STATE, success: true });
  });
});

describe('sendAuthResult fan-out', () => {
  const message: AuthResultMessage = { type: AUTH_MESSAGE_TYPE, state: STATE, success: true };

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

  it('posts to a live opener with the page origin as target', () => {
    const postMessage = vi.fn();
    sendAuthResult(message, { opener: { closed: false, postMessage }, createChannel: () => null });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(message, window.location.origin);
  });

  it('skips a closed or absent opener', () => {
    const postMessage = vi.fn();
    sendAuthResult(message, { opener: { closed: true, postMessage }, createChannel: () => null });
    sendAuthResult(message, { opener: null, createChannel: () => null });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('broadcasts on the state-scoped channel and closes it', () => {
    const channels: FakeChannel[] = [];
    sendAuthResult(message, {
      opener: null,
      createChannel: (name) => {
        const channel = new FakeChannel(name);
        channels.push(channel);
        return channel;
      },
    });
    expect(channels[0]?.name).toBe(`elitea-auth-${STATE}`);
    expect(channels[0]?.sent).toEqual([message]);
    expect(channels[0]?.closed).toBe(true);
  });

  it('always writes the localStorage fallback under the el. namespace', () => {
    sendAuthResult(message, { opener: null, createChannel: () => null });
    expect(JSON.parse(window.localStorage.getItem(`el.auth.result.${STATE}`) ?? 'null')).toEqual(message);
  });

  it('survives a throwing opener and a throwing channel factory (§3.6 handled)', () => {
    const opener = {
      closed: false,
      postMessage: () => {
        throw new Error('opener gone');
      },
    };
    const createChannel = (): AuthChannelLike | null => {
      throw new Error('no channels here');
    };
    expect(() => sendAuthResult(message, { opener, createChannel })).not.toThrow();
    expect(JSON.parse(window.localStorage.getItem(`el.auth.result.${STATE}`) ?? 'null')).toEqual(message);
  });

  it('uses window.opener + real BroadcastChannel by default', () => {
    // window.opener is null in jsdom; the real BroadcastChannel path runs.
    expect(() => sendAuthResult(message)).not.toThrow();
    expect(JSON.parse(window.localStorage.getItem(`el.auth.result.${STATE}`) ?? 'null')).toEqual(message);
  });
});
