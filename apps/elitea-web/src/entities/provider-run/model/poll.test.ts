import { describe, expect, it } from 'vitest';
import { drainEventMessages, isTerminalPoll, terminalOutcome } from './poll';

describe('isTerminalPoll', () => {
  it.each([
    [undefined, false],
    [{}, false],
    [{ status: 'Started' }, false],
    [{ status: 'InProgress' }, false],
    [{ status: 'Completed' }, true],
    [{ status: 'Error' }, true],
    [{ status: 'Stopped' }, true],
  ])('%o → %s', (poll, terminal) => {
    expect(isTerminalPoll(poll)).toBe(terminal);
  });
});

describe('drainEventMessages', () => {
  it('keeps every non-empty message, in order, whatever its type', () => {
    const structured = { event: 'tool_start', data: { name: 'clone' } };
    expect(
      drainEventMessages({
        custom_events: [
          { data: { message: 'Cloning' } },
          { data: { message: '' } },
          { data: {} },
          {},
          { data: { message: structured } },
          { data: { message: null } },
          { data: { message: 'Indexing' } },
        ],
      }),
    ).toEqual(['Cloning', structured, 'Indexing']);
  });

  it('is empty for a poll with no events, and for no poll', () => {
    expect(drainEventMessages({ status: 'InProgress' })).toEqual([]);
    expect(drainEventMessages(undefined)).toEqual([]);
  });
});

describe('terminalOutcome', () => {
  it('has no outcome while the run is going, or without a poll', () => {
    expect(terminalOutcome(undefined, 'x')).toBeNull();
    expect(terminalOutcome({}, 'x')).toBeNull();
    expect(terminalOutcome({ status: 'Started' }, 'x')).toBeNull();
    expect(terminalOutcome({ status: 'InProgress', result: 'ignored' }, 'x')).toBeNull();
  });

  it('passes a completed result through unparsed, and empty when absent', () => {
    expect(terminalOutcome({ status: 'Completed', result: '[{"a":1}]' }, 'x')).toEqual({
      kind: 'completed',
      status: 'Completed',
      result: '[{"a":1}]',
    });
    expect(terminalOutcome({ status: 'Completed' }, 'x')).toEqual({ kind: 'completed', status: 'Completed', result: '' });
  });

  it('carries the category and type of a failure, and Stopped is a failure too', () => {
    expect(
      terminalOutcome({ status: 'Error', result: 'boom', error_category: 'service_busy', error_type: 'RuntimeError' }, 'x'),
    ).toEqual({ kind: 'failed', status: 'Error', message: 'boom', errorCategory: 'service_busy', errorType: 'RuntimeError' });
    expect(terminalOutcome({ status: 'Stopped' }, 'The run was stopped.')).toEqual({
      kind: 'failed',
      status: 'Stopped',
      message: 'The run was stopped.',
      errorCategory: undefined,
      errorType: undefined,
    });
  });

  it('prefers result, then message, then the fallback', () => {
    expect(terminalOutcome({ status: 'Error', result: 'r', message: 'm' }, 'f')).toMatchObject({ message: 'r' });
    expect(terminalOutcome({ status: 'Error', message: 'm' }, 'f')).toMatchObject({ message: 'm' });
    expect(terminalOutcome({ status: 'Error' }, 'f')).toMatchObject({ message: 'f' });
  });
});
