/**
 * Drive one generation: poll the invocation, feed the frames to the reducer.
 *
 * THE REDUCER IS PURE AND THIS IS WHERE THE WORLD TOUCHES IT. Everything that
 * decides what the user sees lives in `reduceGeneration`, tested against a
 * recording of the legacy behaviour. This hook owns only the loop, and the loop
 * has one rule that matters.
 *
 * EXACTLY ONE POLLER. `custom_events` is read-once: a poll returns what
 * accumulated since the previous one and the provider then forgets it. Two
 * pollers would each consume events the other never sees, and the visible
 * symptom is a progress log missing half its lines with nothing logged
 * anywhere. The legacy transport enforced this with module scope; here the
 * effect owns a single interval keyed on the invocation.
 */
import { useEffect, useReducer, useRef } from 'react';

import { framesFromPoll, isTerminalPoll, type InvocationPoll } from '../lib/framesFromPoll';
import { reduceGeneration } from './reducer';
import { initialGenerationState, type GenerationFrame, type GenerationState } from './types';

/** How often a running invocation is polled, in milliseconds. */
export const POLL_INTERVAL_MS = 2000;

export interface WikiGenerationOptions {
  /** Fetch one poll. Injected so the loop is testable without a network. */
  readonly poll: (invocationId: string) => Promise<InvocationPoll | undefined>;
  /** Called once when the run reaches a terminal status. */
  readonly onSettled?: (state: GenerationState) => void;
  readonly intervalMs?: number;
}

type Action = { readonly kind: 'frames'; readonly frames: readonly GenerationFrame[] } | { readonly kind: 'reset' };

function applyFrames(state: GenerationState, action: Action): GenerationState {
  // A NEW INVOCATION STARTS CLEAN. Without this the second generation inherits
  // the first's state, and if the first ENDED IN AN ERROR the reducer's own
  // rule — an errored run ignores every later frame — makes the new run appear
  // frozen at the old failure, for ever, with nothing logged. Found by
  // mutation: the onSettled guard survived because no test ever started a
  // second run.
  if (action.kind === 'reset') return initialGenerationState;

  // Frames from ONE poll are applied in order and as a batch: the reducer's
  // own ordering rules only hold if the frames reach it in the order the
  // provider produced them.
  return action.frames.reduce((current, frame) => reduceGeneration(current, frame).state, state);
}

/**
 * Poll `invocationId` until it settles, reducing every frame it yields.
 *
 * A null invocation is idle: no timer is started, so the hook costs nothing on
 * a screen where nothing is generating.
 */
export function useWikiGeneration(
  invocationId: string | null,
  options: WikiGenerationOptions,
): GenerationState {
  const [state, dispatch] = useReducer(applyFrames, initialGenerationState);

  // The callbacks are read through a ref so that a caller passing an inline
  // function does not restart the poller on every render — which would drain
  // events into a poller that is about to be replaced.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const settledRef = useRef(false);

  useEffect(() => {
    if (!invocationId) return undefined;

    settledRef.current = false;
    dispatch({ kind: 'reset' });
    let cancelled = false;
    let inFlight = false;

    const tick = async (): Promise<void> => {
      // One request at a time. Without this, a poll slower than the interval
      // overlaps the next one and the two race for the same read-once events.
      if (inFlight || cancelled || settledRef.current) return;
      inFlight = true;
      try {
        const poll = await optionsRef.current.poll(invocationId);
        if (cancelled) return;
        const frames = framesFromPoll(poll, {
          messageId: invocationId,
          streamId: invocationId,
        });
        if (frames.length > 0) dispatch({ kind: 'frames', frames });
        if (isTerminalPoll(poll)) settledRef.current = true;
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), optionsRef.current.intervalMs ?? POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [invocationId]);

  // onSettled fires from an effect on the STATE, not from inside the poll, so
  // it sees the reduced result rather than the raw frame.
  //
  // NO "already notified" FLAG, deliberately. One was written here and proved
  // to be dead code: this effect depends on `state` alone, and once a run
  // settles the poller stops, so nothing dispatches and the state stops
  // changing — the effect cannot run a second time for one run. A second RUN
  // resets the state, which is what makes it notify again, and that is
  // asserted. A flag would have looked protective while never firing.
  useEffect(() => {
    const terminal = state.status.status === 'completed' || state.status.status === 'error';
    if (!terminal) return;
    optionsRef.current.onSettled?.(state);
  }, [state]);

  return state;
}
