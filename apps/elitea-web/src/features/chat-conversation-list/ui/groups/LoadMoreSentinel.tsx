import { type ReactNode, useEffect, useRef } from 'react';

import Box from '@mui/material/Box';

export interface LoadMoreSentinelProps {
  readonly listCurrentSize: number;
  readonly totalAvailableCount: number;
  readonly onLoadMore: () => void;
  readonly isLoading?: boolean | undefined;
}

/**
 * A small, self-contained infinite-scroll trigger — NOT a port of the
 * baseline's `ComponentsLib/ListInfiniteMoreLoader.jsx`. That file's own
 * `hasTriggeredRef`/timed-reobserve machinery exists to dedupe repeat
 * triggers a single `IntersectionObserver` effect wouldn't otherwise guard
 * against; here that same dedupe already happens one level up, at the
 * caller that owns `loadingGroups` (baseline: `Conversations.jsx`'s
 * `onLoadMoreInGroup`, `if (loadingGroups.has(groupName)) return;` — not yet
 * ported, out of this unit's scope, but `GroupedConversations.tsx` already
 * threads `isLoadingMore` through from that same `loadingGroups` set), so
 * reproducing the extra ref/timer bookkeeping here would just be dead
 * weight. Same `IntersectionObserver`-sentinel shape `features/toolkits/
 * ui/list/ToolkitsList.tsx` already established as this codebase's
 * infinite-scroll pattern (`hasMore && !isLoading` gate, disconnect on
 * cleanup) — reused here as a small standalone component instead of
 * duplicated inline, since `DateGroup.tsx` is the second call site of this
 * exact shape within one unit (`ui/folders/FolderAccordionItem.jsx`'s own
 * `totalAvailableCount={folder.total || 0}` call site is a plausible third,
 * once that cluster exists — this file's export is reusable by an
 * in-feature sibling directory without violating `no-sideways-features`,
 * which only fences cross-FEATURE imports, not cross-directory imports
 * within one feature).
 *
 * Renders nothing but an invisible trigger element while more data is
 * available — same as the baseline's own `visibility: hidden` `<div>`; no
 * visible spinner here, since `DateGroup`'s own skeleton rows already are
 * the loading affordance.
 */
export function LoadMoreSentinel({ listCurrentSize, totalAvailableCount, onLoadMore, isLoading = false }: LoadMoreSentinelProps): ReactNode {
  const hasMore = totalAvailableCount > listCurrentSize;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || isLoading) return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore]);

  if (!hasMore) return null;

  return (
    <Box
      ref={sentinelRef}
      data-testid="conversation-load-more-sentinel"
      sx={{ width: '100%', height: '1.25rem', visibility: 'hidden', pointerEvents: 'none' }}
    />
  );
}
