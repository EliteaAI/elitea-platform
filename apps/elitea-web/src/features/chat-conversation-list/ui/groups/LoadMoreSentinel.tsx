import { type ReactNode, useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';

export interface LoadMoreSentinelProps {
  readonly listCurrentSize: number;
  readonly totalAvailableCount: number;
  readonly onLoadMore: () => void;
  readonly isLoading?: boolean | undefined;
}

/**
 * A small, self-contained infinite-scroll trigger, reused here as a
 * standalone component instead of duplicated inline — same
 * `IntersectionObserver`-sentinel shape `features/toolkits/ui/list/
 * ToolkitsList.tsx` already established as this codebase's infinite-scroll
 * pattern, since `DateGroup.tsx` is the second call site of this exact
 * shape within one unit (`ui/folders/FolderAccordionItem.jsx`'s own
 * `totalAvailableCount={folder.total || 0}` call site is a plausible third,
 * once that cluster exists — this file's export is reusable by an
 * in-feature sibling directory without violating `no-sideways-features`,
 * which only fences cross-FEATURE imports, not cross-directory imports
 * within one feature).
 *
 * Unlike an earlier version of this file, this DOES port two pieces of the
 * baseline's `ComponentsLib/ListInfiniteMoreLoader.jsx` that turned out not
 * to be optional:
 *
 * - The `hasTriggeredRef` latch (`ListInfiniteMoreLoader.jsx:16,29-44`):
 *   the observer callback sets the latch the instant a load-more fires, and
 *   it is only cleared once `isLoading` has gone back to `false` AND
 *   `listCurrentSize` has actually grown past the value it had at trigger
 *   time. This matters because the real caller's `loadingGroups`
 *   (`Conversations.tsx`'s `onLoadMoreInGroup`, out of this unit's scope)
 *   always removes the group in a `finally` block, so `isLoading` flips
 *   back to `false` after every attempt including a FAILED one. Without
 *   this latch, a failed (or empty-page) load-more leaves the sentinel
 *   still intersecting and gated only by the now-`false` `isLoading` prop,
 *   so tearing down and recreating the observer (which immediately reports
 *   the target's current intersection state, per the IntersectionObserver
 *   spec) refires `onLoadMore` — an uninterrupted retry loop. The
 *   caller-side `loadingGroups.has(groupName)` check only blocks a second
 *   *concurrent* call while one is already in flight; it does not stop a
 *   *new* call once the previous one has finished without changing the
 *   count, which is exactly what this latch is for.
 * - The observer's tuning (`ListInfiniteMoreLoader.jsx:59-63`):
 *   `rootMargin: '50px', threshold: 0.1`, so loading starts while the
 *   sentinel is still 50px below the viewport and only 10% visible, rather
 *   than only once it has fully entered view.
 *
 * NOT ported: the baseline's `resetPageDependencies` prop and its
 * `setTimeout`-based unobserve/re-observe on `hasMoreData` false→true
 * transitions (`ListInfiniteMoreLoader.jsx:80-97`) — no call site here ever
 * flips `totalAvailableCount`/`listCurrentSize` back down and up again
 * within one mount, so that transition never occurs for this component's
 * actual caller (`DateGroup.tsx`).
 *
 * Renders nothing but an invisible trigger element while more data is
 * available — same as the baseline's own `visibility: hidden` `<div>`; no
 * visible spinner here, since `DateGroup`'s own skeleton rows already are
 * the loading affordance.
 */
export function LoadMoreSentinel({ listCurrentSize, totalAvailableCount, onLoadMore, isLoading = false }: LoadMoreSentinelProps): ReactNode {
  const hasMore = totalAvailableCount > listCurrentSize;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Latched the instant a load-more fires (see module doc comment); only
  // cleared once loading has finished AND the list has actually grown past
  // its size at trigger time — mirrors baseline `ListInfiniteMoreLoader.
  // jsx:40-44` (`if (!isLoading && listCurrentSize !== prevCount)`).
  const hasTriggeredRef = useRef(false);
  const [sizeAtLastTrigger, setSizeAtLastTrigger] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoading && sizeAtLastTrigger !== null && listCurrentSize !== sizeAtLastTrigger) {
      hasTriggeredRef.current = false;
      setSizeAtLastTrigger(null);
    }
  }, [isLoading, listCurrentSize, sizeAtLastTrigger]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || isLoading) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (hasTriggeredRef.current) return;
        if (entries.some((entry) => entry.isIntersecting)) {
          hasTriggeredRef.current = true;
          setSizeAtLastTrigger(listCurrentSize);
          onLoadMore();
        }
      },
      { root: null, rootMargin: '50px', threshold: 0.1 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoading, listCurrentSize, onLoadMore]);

  if (!hasMore) return null;

  return (
    <Box
      ref={sentinelRef}
      data-testid="conversation-load-more-sentinel"
      sx={{ width: '100%', height: '1.25rem', visibility: 'hidden', pointerEvents: 'none' }}
    />
  );
}
