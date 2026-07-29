/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useStreamingNavBlocker.js` —
 * mirrors whether a chat response is currently streaming into the
 * navigation-blocker store, so `NavBlockerDialog` (unit W-shell) blocks
 * in-app navigation and the browser's `beforeunload` prompt while a
 * generation is in flight. Resets to not-streaming on unmount.
 *
 * **DEVIATIONS (disclosed):**
 *  1. The baseline dispatched `settingsActions.setStreamingBlockNav({
 *     isStreaming, streamingType })` into Redux, where `streamingType` was
 *     derived from route params (`agentId ? 'application' : ''`) — a fairly
 *     thin signal. This app's already-landed nav-blocker store
 *     (`widgets/app-shell/model/navBlocker.store.ts`, unit W-shell) instead
 *     types `streamingType` as `'prompt' | 'canvas'` — the two REAL
 *     generation contexts (chat/agent/pipeline prompt streaming vs. canvas
 *     content streaming), a more useful signal than the baseline's
 *     route-sniffed entity type. This hook therefore takes `streamingType`
 *     as an explicit `'prompt' | 'canvas'` parameter from the caller
 *     (which already knows which kind of stream it owns) rather than trying
 *     to reverse-derive the baseline's weaker signal.
 *  2. `StyledTabsContext`'s `setChatStreamingInfo` (a legacy tab-title
 *     "streaming…" indicator context, `components/StyledTabs`) has no
 *     equivalent anywhere in this app yet (grepped — no `StyledTabsContext`
 *     port exists) — dropped. If a future unit ports the tab-title
 *     indicator, it can read this same `useNavBlockerStore().isStreaming`
 *     directly rather than needing a second bridge.
 *  3. `useParams()`/route-sniffing is gone entirely per deviation 1 — no
 *     replacement needed, the caller supplies `streamingType` directly.
 */
import { useEffect } from 'react';

import { useNavBlockerStore } from '@/widgets/app-shell';
import type { StreamingType } from '@/widgets/app-shell';

export function useStreamingNavBlocker(isExecutingPredict: boolean, streamingType: StreamingType): void {
  const setStreamingBlockNav = useNavBlockerStore((s) => s.setStreamingBlockNav);

  useEffect(() => {
    setStreamingBlockNav(isExecutingPredict, streamingType);
  }, [setStreamingBlockNav, isExecutingPredict, streamingType]);

  useEffect(() => {
    return () => setStreamingBlockNav(false, streamingType);
    // oxlint-disable-next-line react/exhaustive-deps -- intentionally only re-runs on unmount (baseline parity: the cleanup fires once, on unmount, not on every `streamingType` change).
  }, [setStreamingBlockNav]);
}
