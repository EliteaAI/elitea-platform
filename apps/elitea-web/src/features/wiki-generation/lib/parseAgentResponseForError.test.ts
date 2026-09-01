/**
 * The error sniffer, tested against the shapes it exists for.
 *
 * WAIVED PARITY ITEM. Ported bug-for-bug, substring matching included. Every
 * rule here matches prose some upstream produces, and none can be verified from
 * this repository — the strings come from the engine and the models it calls.
 * Tightening one is a bet that a message never changes shape.
 *
 * These are the cases the rules were written for. They are here so that a
 * future tidy-up has to delete a named failure rather than a line that looks
 * arbitrary.
 */
import { describe, expect, it } from 'vitest';

import { parseAgentResponseForError } from './parseAgentResponseForError';

describe('parseAgentResponseForError', () => {
  it('a plain success payload is not an error', () => {
    expect(parseAgentResponseForError('Wiki generated')).toEqual({ isError: false, message: null });
    expect(parseAgentResponseForError({ status: 'Ok' })).toEqual({ isError: false, message: null });
  });

  it('status Error is an error, from content or from metadata', () => {
    expect(parseAgentResponseForError({ status: 'Error', message: 'nope' }).isError).toBe(true);
    expect(parseAgentResponseForError('opaque', { status: 'Error' }).isError).toBe(true);
  });

  it('a JSON STRING is parsed, and the parsed object wins', () => {
    const parsed = parseAgentResponseForError(JSON.stringify({ status: 'Error', message: 'from json' }));
    expect(parsed).toEqual({ isError: true, message: 'from json' });
  });

  it('the slots message names the counts, because that is what a user can act on', () => {
    const parsed = parseAgentResponseForError({
      error_category: 'service_busy',
      active_workers: 3,
      max_workers: 3,
    });
    expect(parsed.message).toBe(
      'Max parallel wiki generations reached: 3/3 slots taken. ' +
        'Please wait for a running generation to finish and try again.',
    );
  });

  it('a partial slots payload falls through rather than rendering undefined', () => {
    // Only one count present. The legacy guard requires BOTH to be numbers,
    // and without it the user sees "3/undefined slots taken".
    const parsed = parseAgentResponseForError({
      error_category: 'service_busy',
      active_workers: 3,
      message: 'busy',
    });
    expect(parsed.isError).toBe(true);
    expect(parsed.message).not.toContain('undefined');
    expect(parsed.message).toBe('busy');
  });

  it.each([
    ['[SERVICE_BUSY] all workers taken', 'a bracketed marker'],
    ['The service busy right now', 'lower-cased prose'],
    ['Max parallel wiki generations reached', 'the counts sentence with no counts'],
    ['4/4 slots taken', 'the slots phrase alone'],
    ['inference_failed', 'the inference category as text'],
    ['Generate_wiki failed', 'the engine tool name'],
    ['embedding failed for model x', 'a model failure'],
    ['RuntimeError: boom', 'a python traceback header'],
    ['generation failed', 'the generic phrase'],
  ])('%s is recognised as a failure (%s)', (content) => {
    expect(parseAgentResponseForError(content).isError).toBe(true);
  });

  it('a Syngen array payload yields the human-readable message', () => {
    // Without this, the user sees a serialised envelope instead of their error.
    const parsed = parseAgentResponseForError({
      status: 'Error',
      result: JSON.stringify([
        { object_type: 'debug', data: 'noise' },
        { object_type: 'message', data: 'The repository could not be cloned.' },
      ]),
    });
    expect(parsed.message).toBe('The repository could not be cloned.');
  });

  it('a payload it cannot understand is NOT called a failure', () => {
    // The outer catch returns "not an error" on purpose: guessing would turn a
    // working generation into a reported error.
    const hostile = { get status() { throw new Error('boom'); } };
    expect(parseAgentResponseForError(hostile)).toEqual({ isError: false, message: null });
  });
});
