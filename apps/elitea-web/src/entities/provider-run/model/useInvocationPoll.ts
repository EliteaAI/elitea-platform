import { useEffect, useRef } from 'react';
import { isTerminalPoll, type InvocationPoll } from './poll';

/** How often a running invocation is polled, in milliseconds. */
export const DEFAULT_POLL_INTERVAL_MS = 2000;

export interface InvocationPollOptions {
  /** Fetch one poll. Injected so the loop is testable without a network. */
  readonly poll: (invocationId: string) => Promise<InvocationPoll | undefined>;
  /**
   * Receives every poll, in order, running or terminal. This is where a
   * consumer turns the poll into its own frames and reduces them; the loop
   * never looks inside a poll beyond its status.
   */
  readonly onPoll: (poll: InvocationPoll | undefined, invocationId: string) => void;
  readonly intervalMs?: number | undefined;
}

/**
 * The invoke → poll → cancel loop every provider-backed run shares.
 *
 * While `invocationId` is set, the invocation is polled on an interval,
 * ONE REQUEST AT A TIME — a poll slower than the interval must not overlap
 * the next one, because the two would race for the same read-once events —
 * and the loop stops itself on the first terminal poll. A new id restarts
 * it; null stops it. The callbacks are read through a ref so a caller
 * passing an inline function does not restart the poller on every render,
 * which would drain events into a poller about to be replaced.
 */
export function useInvocationPoll(invocationId: string | null, options: InvocationPollOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!invocationId) return undefined;
    let cancelled = false;
    let inFlight = false;
    let settled = false;

    const tick = async (): Promise<void> => {
      if (inFlight || cancelled || settled) return;
      inFlight = true;
      try {
        const poll = await optionsRef.current.poll(invocationId);
        if (cancelled) return;
        optionsRef.current.onPoll(poll, invocationId);
        if (isTerminalPoll(poll)) settled = true;
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), optionsRef.current.intervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [invocationId]);
}
