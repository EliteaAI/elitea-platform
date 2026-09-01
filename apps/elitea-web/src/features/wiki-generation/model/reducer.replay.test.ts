/**
 * Replay the whole recorded oracle through the TypeScript reducer.
 *
 * WHAT THE ORACLE IS. The legacy `handleWikiSocketMessage` callback was sliced
 * out of apps/deepwiki-ui/src/DeepWikiApp.jsx PROGRAMMATICALLY — never retyped,
 * because a transcription is a second implementation and a differential against
 * a copy proves nothing about the code that ships. It was given stub setters
 * and a fixed clock, driven over 26 frame sequences, and everything it did was
 * recorded into __fixtures__/generation-oracle.json.
 *
 * WHY A REPLAY TEST AND NOT ONLY PER-TYPE TESTS. A per-type test cannot see a
 * bug that needs two frames in a particular order, and a generation stream is
 * nothing but ordered frames. The ordering sequences are what found the
 * divergence recorded below — no single-frame test could have.
 *
 * THE ONE SEQUENCE THAT DIVERGES is listed explicitly, with the legacy output
 * written out. A divergence that is not in this list fails the test, so the
 * port cannot drift silently and a second divergence cannot hide behind the
 * first.
 */
import { describe, expect, it } from 'vitest';

import oracle from '../lib/__fixtures__/generation-oracle.json';
import { initialGenerationState, type GenerationFrame } from './types';
import { reduceGeneration } from './reducer';

const FIXED_NOW = 1767225600000;

/**
 * Sequences where this port deliberately differs, and why.
 *
 * See reducer.ts's header: the legacy error branch never sets the errored flag
 * that its own agent_response guard consults, so a failed generation reports
 * "Wiki generated successfully!". Recorded as a waived parity item because a
 * false success is the one outcome a user cannot recover from by retrying.
 */
const DELIBERATE_DIVERGENCES: Record<string, string> = {
  'error-then-late-frames':
    'the legacy reducer moves an errored run back to running and then to ' +
    'completed; this one ignores every frame after the error',
  'thinking-step-from-poll-adapter':
    'the legacy reducer reads only content.message, so a poll-synthesised ' +
    'progress event renders "Processing..." and its text is discarded; this ' +
    'one reads a plain-string content as the message',
};

interface Recorded {
  frames: GenerationFrame[];
  observed: {
    generationStatus: { status: string; message: string }[];
    thinkingSteps: { id: string; message: string; type: string }[];
  };
}

const RECORDED = oracle as unknown as Record<string, Recorded>;

function replay(frames: GenerationFrame[]) {
  let state = initialGenerationState;
  const statuses: { status: string; message: string }[] = [];
  for (const frame of frames) {
    const before = state.status;
    const result = reduceGeneration(state, frame, { now: () => FIXED_NOW });
    state = result.state;
    // The legacy reducer recorded a status call only when it made one; compare
    // like for like by recording a status only when it CHANGED.
    if (state.status !== before) statuses.push({ ...state.status });
  }
  return { state, statuses };
}

describe('the generation reducer replays the recorded legacy behaviour', () => {
  // A floor. An emptied or reshaped fixture would make every case below pass
  // by iterating over nothing.
  it('the oracle carries every recorded sequence', () => {
    expect(Object.keys(RECORDED).length).toBeGreaterThanOrEqual(26);
  });

  for (const [name, recorded] of Object.entries(RECORDED)) {
    const divergence = DELIBERATE_DIVERGENCES[name];

    it(`${name}${divergence ? ' (diverges on purpose)' : ''}`, () => {
      const { state, statuses } = replay(recorded.frames);

      if (divergence) {
        // A divergence is ASSERTED, not skipped: the legacy output is what the
        // fixture holds, and this port must not reproduce it. Each case also
        // says what it produces instead, so "diverges" cannot become a licence
        // to produce anything.
        expect(statuses).not.toEqual(recorded.observed.generationStatus);
        if (name === 'error-then-late-frames') {
          expect(state.status.status).toBe('error');
          expect(state.errored).toBe(true);
        } else {
          expect(state.status.message).toBe('Cloning the repository');
          expect(state.thinkingSteps.at(-1)?.message).toBe('Cloning the repository');
        }
        return;
      }

      expect(statuses).toEqual(recorded.observed.generationStatus);
      expect(state.thinkingSteps.map((s) => ({ id: s.id, message: s.message, type: s.type }))).toEqual(
        recorded.observed.thinkingSteps.map((s) => ({ id: s.id, message: s.message, type: s.type })),
      );
    });
  }
});
