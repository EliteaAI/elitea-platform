import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InvocationPoll } from './poll';
import { useInvocationPoll } from './useInvocationPoll';

/** A poll source that answers a scripted sequence, then repeats the last. */
function scripted(sequence: readonly (InvocationPoll | undefined)[]) {
  const calls: string[] = [];
  let index = 0;
  const poll = (id: string): Promise<InvocationPoll | undefined> => {
    calls.push(id);
    const next = sequence[Math.min(index, sequence.length - 1)];
    index += 1;
    return Promise.resolve(next);
  };
  return { poll, calls };
}

describe('useInvocationPoll', () => {
  it('does not poll without an invocation', async () => {
    const source = scripted([{ status: 'Completed' }]);
    renderHook(() => useInvocationPoll(null, { poll: source.poll, onPoll: () => undefined, intervalMs: 5 }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(source.calls).toEqual([]);
  });

  it('hands every poll to the consumer in order and stops at the first terminal one', async () => {
    const source = scripted([{ status: 'Started' }, { status: 'InProgress' }, { status: 'Completed', result: 'r' }]);
    const seen: (string | undefined)[] = [];
    renderHook(() =>
      useInvocationPoll('inv-1', {
        poll: source.poll,
        onPoll: (poll, id) => seen.push(`${id}:${poll?.status}`),
        intervalMs: 5,
      }),
    );
    await waitFor(() => expect(seen).toContain('inv-1:Completed'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen).toEqual(['inv-1:Started', 'inv-1:InProgress', 'inv-1:Completed']);
    // No poll after the terminal one: the read-once events are never re-asked for.
    expect(source.calls).toHaveLength(3);
  });

  it('never has two polls in flight at once', async () => {
    let inFlight = 0;
    let overlapped = false;
    let resolveFirst: (() => void) | null = null;
    const poll = async (): Promise<InvocationPoll> => {
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      if (resolveFirst === null) {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      }
      inFlight -= 1;
      return { status: resolveFirst === null ? 'InProgress' : 'Completed' };
    };
    renderHook(() => useInvocationPoll('inv-2', { poll, onPoll: () => undefined, intervalMs: 5 }));
    // Three intervals pass while the first poll is still open.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(overlapped).toBe(false);
    (resolveFirst as unknown as () => void)();
    await waitFor(() => expect(inFlight).toBe(0));
    expect(overlapped).toBe(false);
  });

  it('restarts for a new invocation and drops a stale poll after the id changed', async () => {
    const first = scripted([{ status: 'InProgress' }]);
    const second = scripted([{ status: 'Completed' }]);
    const seen: string[] = [];
    const initial: { id: string | null; poll: typeof first.poll } = { id: 'a', poll: first.poll };
    const { rerender } = renderHook(
      ({ id, poll }: typeof initial) =>
        useInvocationPoll(id, { poll, onPoll: (p, invocationId) => seen.push(`${invocationId}:${p?.status}`), intervalMs: 5 }),
      { initialProps: initial },
    );
    await waitFor(() => expect(seen).toContain('a:InProgress'));
    rerender({ id: 'b', poll: second.poll });
    await waitFor(() => expect(seen).toContain('b:Completed'));
    const firstCalls = first.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    // The old loop is gone: no more calls against the first invocation.
    expect(first.calls.length).toBe(firstCalls);
    rerender({ id: null, poll: second.poll });
    const secondCalls = second.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(second.calls.length).toBe(secondCalls);
  });

  it('drops a poll that resolves after the loop was stopped', async () => {
    // A poll is in flight when the consumer unmounts (or moves to another
    // invocation). Its late answer must not reach onPoll: the consumer's
    // state is no longer this run's, and the events it carries are gone
    // either way.
    let resolvePoll: ((poll: InvocationPoll) => void) | null = null;
    const poll = (): Promise<InvocationPoll> =>
      new Promise<InvocationPoll>((resolve) => {
        resolvePoll = resolve;
      });
    const delivered: InvocationPoll[] = [];
    const { unmount } = renderHook(() => useInvocationPoll('inv-4', { poll, onPoll: (p) => p && delivered.push(p), intervalMs: 5 }));
    await waitFor(() => expect(resolvePoll).not.toBeNull());
    unmount();
    (resolvePoll as unknown as (poll: InvocationPoll) => void)({ status: 'Completed', result: 'late' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(delivered).toEqual([]);
  });

  it('reads the callbacks through a ref, so an inline callback does not restart the loop', async () => {
    const source = scripted([{ status: 'InProgress' }, { status: 'InProgress' }, { status: 'Completed' }]);
    let renders = 0;
    const { rerender } = renderHook(() => {
      renders += 1;
      useInvocationPoll('inv-3', { poll: source.poll, onPoll: () => undefined, intervalMs: 5 });
    });
    rerender();
    rerender();
    await waitFor(() => expect(source.calls.length).toBe(3));
    expect(renders).toBe(3);
    // A restart per render would have re-polled from the start: the first
    // poll would be asked for more than once.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(source.calls.length).toBe(3);
  });
});
