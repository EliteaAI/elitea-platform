/**
 * The polling loop. The reducer is tested elsewhere; this covers the rules the
 * loop owns, and every one of them fails silently if broken.
 */
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InvocationPoll } from '../lib/framesFromPoll';
import type { GenerationState } from './types';
import { renderHookWithProviders } from '../../wiki-browser/__tests__/testUtils';
import { useWikiGeneration } from './useWikiGeneration';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

/** A poller that returns a scripted sequence and counts its calls. */
function scripted(polls: InvocationPoll[]) {
  let index = 0;
  const calls: string[] = [];
  return {
    calls,
    poll: (invocationId: string) => {
      calls.push(invocationId);
      const poll = polls[Math.min(index, polls.length - 1)];
      index += 1;
      return Promise.resolve(poll);
    },
  };
}

describe('useWikiGeneration', () => {
  it('does not poll at all while there is no invocation', async () => {
    const source = scripted([{ status: 'InProgress' }]);
    renderHookWithProviders(() => useWikiGeneration(null, { poll: source.poll, intervalMs: 10 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    // An idle screen must cost nothing.
    expect(source.calls).toEqual([]);
  });

  it('reduces the events a poll carries into visible progress', async () => {
    const source = scripted([
      {
        status: 'InProgress',
        custom_events: [{ data: { message: 'Cloning repository' } }],
      },
    ]);
    const { result } = renderHookWithProviders(() =>
      useWikiGeneration('inv-1', { poll: source.poll, intervalMs: 10 }),
    );
    await waitFor(() => {
      expect(result.current.status.message).toBe('Cloning repository');
    });
    // The legacy reducer rendered "Processing..." here — see thinkingFrames.ts.
    expect(result.current.thinkingSteps.at(-1)?.message).toBe('Cloning repository');
  });

  it('stops polling once the invocation settles', async () => {
    const source = scripted([
      { status: 'InProgress' },
      { status: 'Completed', result: 'done' },
    ]);
    const { result } = renderHookWithProviders(() =>
      useWikiGeneration('inv-2', { poll: source.poll, intervalMs: 10 }),
    );
    await waitFor(() => {
      expect(result.current.status.status).toBe('completed');
    });
    const afterSettle = source.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    // A poller that keeps running after a terminal status is a request every
    // two seconds, for ever, for a run that is over.
    expect(source.calls.length).toBe(afterSettle);
  });

  it('never runs two polls at once', async () => {
    // The read-once rule. Two overlapping polls each consume events the other
    // never sees, and the symptom is a progress log missing half its lines.
    let concurrent = 0;
    let maxConcurrent = 0;
    const poll = async (): Promise<InvocationPoll> => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 30));
      concurrent -= 1;
      return { status: 'InProgress' };
    };
    renderHookWithProviders(() => useWikiGeneration('inv-3', { poll, intervalMs: 5 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(maxConcurrent).toBe(1);
  });

  it('reports settlement once, with the reduced state', async () => {
    const onSettled = vi.fn();
    const source = scripted([{ status: 'Error', message: 'it broke' }]);
    renderHookWithProviders(() =>
      useWikiGeneration('inv-4', { poll: source.poll, onSettled, intervalMs: 10 }),
    );
    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledTimes(1);
    });
    const settled = onSettled.mock.calls[0]?.[0] as GenerationState | undefined;
    expect(settled?.status.status).toBe('error');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    // Once, not once per subsequent render.
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});

describe('a second generation', () => {
  // Found by mutation: the onSettled guard survived because no test started a
  // second run — and doing so exposed a real bug. Without the reset, the new
  // run inherits `errored: true` and the reducer ignores every one of its
  // frames, so it appears frozen at the previous failure for ever.
  it('starts from a clean state rather than inheriting the previous failure', async () => {
    const poll = (id: string): Promise<InvocationPoll> =>
      Promise.resolve(
        id === 'first'
          ? { status: 'Error', message: 'first failed' }
          : { status: 'InProgress', custom_events: [{ data: { message: 'second running' } }] },
      );
    const { result, rerender } = renderHookWithProviders(
      ({ id }: { id: string }) => useWikiGeneration(id, { poll, intervalMs: 5 }),
      undefined,
      { initialProps: { id: 'first' } },
    );
    await waitFor(() => {
      expect(result.current.status.status).toBe('error');
    });

    rerender({ id: 'second' });
    await waitFor(() => {
      expect(result.current.status.message).toBe('second running');
    });
    expect(result.current.errored).toBe(false);
  });

  it('reports its own settlement', async () => {
    const onSettled = vi.fn();
    const poll = (): Promise<InvocationPoll> => Promise.resolve({ status: 'Error', message: 'x' });
    const { rerender } = renderHookWithProviders(
      ({ id }: { id: string }) => useWikiGeneration(id, { poll, onSettled, intervalMs: 5 }),
      undefined,
      { initialProps: { id: 'a' } },
    );
    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledTimes(1);
    });
    rerender({ id: 'b' });
    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledTimes(2);
    });
  });
});
