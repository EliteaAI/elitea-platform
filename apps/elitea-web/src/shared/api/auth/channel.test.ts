/** BroadcastChannel seam — real-channel round trip in jsdom. */
import { describe, expect, it } from 'vitest';

import { createBroadcastChannel } from './channel';

describe('createBroadcastChannel', () => {
  it('round-trips a message between two channels of the same name', async () => {
    const a = createBroadcastChannel('el-test-channel');
    const b = createBroadcastChannel('el-test-channel');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (a === null || b === null) throw new Error('BroadcastChannel unavailable');

    const received = new Promise<unknown>((resolve) => {
      b.onmessage = (event) => {
        resolve(event.data);
      };
    });
    a.postMessage({ hello: 'popup' });
    await expect(received).resolves.toEqual({ hello: 'popup' });

    a.close();
    b.close();
  });

  it('a channel with no handler attached ignores messages', async () => {
    const a = createBroadcastChannel('el-test-quiet');
    const b = createBroadcastChannel('el-test-quiet');
    if (a === null || b === null) throw new Error('BroadcastChannel unavailable');
    a.postMessage('ignored'); // b.onmessage is null — must not throw
    await new Promise((r) => setTimeout(r, 5));
    a.close();
    b.close();
    expect(true).toBe(true);
  });
});
