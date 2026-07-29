import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { LoadMoreSentinel } from './LoadMoreSentinel';

/** Same shape as `features/toolkits/ui/list/ToolkitsList.test.tsx`'s own `MockIntersectionObserver` — this codebase's established IntersectionObserver test double, since jsdom has no real implementation. */
class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds: readonly number[] = [];
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
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
});
