import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { LoadMoreSentinel } from './LoadMoreSentinel';

/** Same shape as `features/toolkits/ui/list/ToolkitsList.test.tsx`'s own `MockIntersectionObserver` — this codebase's established IntersectionObserver test double, since jsdom has no real implementation. Also records the constructor `options` so tests can assert on the `rootMargin`/`threshold` tuning. */
class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds: readonly number[] = [];
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(isIntersecting: boolean): void {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this);
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoadMoreSentinel', () => {
  it('renders no trigger element once the list is exhausted (currentSize >= total)', () => {
    const { queryByTestId } = renderWithTheme(
      <LoadMoreSentinel
        listCurrentSize={5}
        totalAvailableCount={5}
        onLoadMore={vi.fn()}
      />,
    );
    expect(queryByTestId('conversation-load-more-sentinel')).not.toBeInTheDocument();
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it('renders the trigger and observes it while more data is available', () => {
    const { queryByTestId } = renderWithTheme(
      <LoadMoreSentinel
        listCurrentSize={2}
        totalAvailableCount={5}
        onLoadMore={vi.fn()}
      />,
    );
    expect(queryByTestId('conversation-load-more-sentinel')).toBeInTheDocument();
    expect(MockIntersectionObserver.instances).toHaveLength(1);
  });

  it('calls onLoadMore once the sentinel intersects', () => {
    const onLoadMore = vi.fn();
    renderWithTheme(
      <LoadMoreSentinel
        listCurrentSize={2}
        totalAvailableCount={5}
        onLoadMore={onLoadMore}
      />,
    );
    MockIntersectionObserver.instances[0]?.trigger(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not observe while a load is already in flight (isLoading)', () => {
    renderWithTheme(
      <LoadMoreSentinel
        listCurrentSize={2}
        totalAvailableCount={5}
        onLoadMore={vi.fn()}
        isLoading
      />,
    );
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it('observes with a 50px rootMargin and a 0.1 threshold, matching the baseline pre-loading tuning', () => {
    renderWithTheme(
      <LoadMoreSentinel
        listCurrentSize={2}
        totalAvailableCount={5}
        onLoadMore={vi.fn()}
      />,
    );
    expect(MockIntersectionObserver.instances[0]?.options).toEqual({ root: null, rootMargin: '50px', threshold: 0.1 });
  });

  it('does not refire onLoadMore after a failed load-more that left listCurrentSize unchanged', () => {
    const onLoadMore = vi.fn();
    const { rerender } = renderWithTheme(
      <LoadMoreSentinel
        listCurrentSize={2}
        totalAvailableCount={5}
        onLoadMore={onLoadMore}
      />,
    );

    // Sentinel intersects, triggering the first (and only expected) load-more.
    MockIntersectionObserver.instances[0]?.trigger(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Caller flips isLoading true while the request is in flight...
    rerender(
      <LoadMoreSentinel
        listCurrentSize={2}
        totalAvailableCount={5}
        onLoadMore={onLoadMore}
        isLoading
      />,
    );
    // ...then the load-more fails and the caller's `finally` block flips
    // isLoading back to false without listCurrentSize having grown — the
    // exact case the baseline's hasTriggeredRef latch exists to guard.
    rerender(
      <LoadMoreSentinel
        listCurrentSize={2}
        totalAvailableCount={5}
        onLoadMore={onLoadMore}
      />,
    );

    // The still-intersecting sentinel gets a freshly (re)created observer;
    // per the IntersectionObserver spec that reports the current
    // intersection state immediately, so simulate that here too.
    const latestInstance = MockIntersectionObserver.instances.at(-1);
    latestInstance?.trigger(true);

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('allows a new trigger once listCurrentSize has actually grown after loading finishes', () => {
    const onLoadMore = vi.fn();
    const { rerender } = renderWithTheme(
      <LoadMoreSentinel
        listCurrentSize={2}
        totalAvailableCount={5}
        onLoadMore={onLoadMore}
      />,
    );

    MockIntersectionObserver.instances[0]?.trigger(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      <LoadMoreSentinel
        listCurrentSize={2}
        totalAvailableCount={5}
        onLoadMore={onLoadMore}
        isLoading
      />,
    );
    // This time the load-more succeeds: listCurrentSize grows once isLoading
    // clears, so the latch should reset and allow another trigger.
    rerender(
      <LoadMoreSentinel
        listCurrentSize={4}
        totalAvailableCount={5}
        onLoadMore={onLoadMore}
      />,
    );

    const latestInstance = MockIntersectionObserver.instances.at(-1);
    latestInstance?.trigger(true);

    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });
});
