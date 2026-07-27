/**
 * Minimal BroadcastChannel seam for the auth flow: both sides (popup
 * controller, callback page) speak this narrow interface so tests inject an
 * in-memory pair and production wraps a real `BroadcastChannel`.
 */

export interface AuthChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(data: unknown): void;
  close(): void;
}

/** `null` where BroadcastChannel is unavailable — callers treat it as optional. */
export function createBroadcastChannel(name: string): AuthChannelLike | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const raw = new BroadcastChannel(name);
  const like: AuthChannelLike = {
    onmessage: null,
    postMessage(data) {
      raw.postMessage(data);
    },
    close() {
      raw.close();
    },
  };
  raw.onmessage = (event: MessageEvent<unknown>): void => {
    like.onmessage?.({ data: event.data });
  };
  return like;
}
