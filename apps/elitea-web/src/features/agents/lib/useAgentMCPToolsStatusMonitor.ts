import { useCallback, useEffect, useMemo } from 'react';

import { applyMcpToolStatus } from '@/entities/application-form';
import { useSocketClient } from '@/shared/api/socket/client';
import type { ReceivePayloadOf } from '@/shared/api/socket/events';

/**
 * Ported from
 * `apps/elitea-ui/src/hooks/application/useAgentMCPToolsStatusMonitor.js`
 * (Wave-2 unit A1e). Subscribes to the `mcp_status` socket event
 * (`SOCK-`-catalogued in `shared/api/socket/events.ts`, unit S5 — also
 * consumed by `useMCPParticipantStatusMonitor.js` and
 * `useGetCurrentToolkitSchemas.hooks.js`, per that catalogue's own
 * evidence trail) and, when the version currently being edited has at
 * least one MCP-flavoured tool, flags the matching tool `online`/offline
 * live while the form is open.
 *
 * The per-tool merge itself (`applyMcpToolStatus`) was already promoted
 * verbatim to `entities/application-form` (Wave-2 promotion pass, Part 3 —
 * see that file's own doc comment) and is reused here rather than
 * re-implemented.
 *
 * **DEVIATIONS FROM BASELINE (both disclosed):**
 *  1. Formik (`useFormikContext`) + Redux (`useSelector`/`dispatch`,
 *     `eliteaApi.util.updateQueryData`) are replaced with a single injected
 *     `onToolsChange` callback. This app has neither Formik nor Redux/RTK
 *     Query (§2.3: react-hook-form + TanStack Query) — the baseline's own
 *     branching ("form is dirty -> patch local Formik state" vs "form is
 *     clean -> patch the RTK Query cache directly, keyed by
 *     `applicationDetails` cache entries matching this project/application")
 *     has no faithful 1:1 target either way: TanStack Query has no
 *     structural equivalent of iterating `state.eliteaApi.queries` by
 *     `endpointName`, and this unit does not own the application-detail
 *     query key any sibling A1 sub-unit will eventually define. Collapsing
 *     both baseline branches into one injected callback — called with the
 *     version's CURRENT tools array plus the already-computed next array —
 *     lets the caller apply it to whichever state it actually owns (a
 *     react-hook-form field via `setValue`, a TanStack Query cache via
 *     `queryClient.setQueryData`, or both), matching this codebase's
 *     established "the caller supplies the state-write, this hook only
 *     computes what changed" convention (see `ApplicationValidator.tsx`'s
 *     injected `useValidate`).
 *  2. `useSocket(sioEvents.mcp_status, handler)` (a raw socket.io context
 *     hook + a hand-typed event-name constant) is replaced with unit S5's
 *     typed `useSocketClient().on('mcp_status', handler)` /
 *     `.off(...)` pair — the same substitution `useMcpAuthCheck.ts` (unit
 *     A5) already made for `test_mcp_connection`, subscribing/
 *     unsubscribing in a `useEffect` instead of relying on a custom
 *     `useSocket` hook's own internal lifecycle.
 */
export interface AgentMcpToolLike {
  readonly type?: string;
}

export interface UseAgentMCPToolsStatusMonitorParams<T extends AgentMcpToolLike> {
  /** The version currently being edited/viewed's tools array. */
  readonly tools: readonly T[] | undefined;
  /** The project this form belongs to — events for any OTHER project are ignored, matching the baseline's `projectId === project_id` guard (both its dirty-form and cache-write branches carried it). */
  readonly projectId: string | undefined;
  /** Called with the recomputed tools array whenever a relevant `mcp_status` event arrives — never called when nothing in `tools` is MCP-flavoured (mirrors the baseline's `isMCP` short-circuit) or the event names a different project. */
  readonly onToolsChange: (nextTools: readonly (T & { readonly online?: boolean })[]) => void;
}

/**
 * `true` when at least one tool in `tools` carries MCP metadata
 * (`tool.meta?.mcp`) — mirrors the baseline's `isMCP` `useMemo` exactly,
 * generic over `T` the same way `applyMcpToolStatus` is.
 */
function hasMcpTool<T extends AgentMcpToolLike>(tools: readonly T[] | undefined): boolean {
  return (tools ?? []).some((tool) => Boolean((tool as { readonly meta?: { readonly mcp?: unknown } }).meta?.mcp));
}

export function useAgentMCPToolsStatusMonitor<T extends AgentMcpToolLike>({
  tools,
  projectId,
  onToolsChange,
}: UseAgentMCPToolsStatusMonitorParams<T>): void {
  const socketClient = useSocketClient();
  const isMcp = useMemo(() => hasMcpTool(tools), [tools]);

  const handleMcpStatusEvent = useCallback(
    (event: ReceivePayloadOf<'mcp_status'>) => {
      if (!isMcp) return;
      const { type, connected, project_id: eventProjectId } = event;
      if (type === undefined || connected === undefined) return;
      if (projectId !== undefined && eventProjectId !== undefined && String(eventProjectId) !== projectId) return;
      // Structural match against `applyMcpToolStatus`'s `McpStatusEvent` parameter —
      // that type isn't re-exported from `entities/application-form`'s public
      // index.ts (R-L3 forbids a deep import to `model/toolStatus.ts` just for it).
      onToolsChange(applyMcpToolStatus(tools ?? [], { type, connected }));
    },
    [isMcp, onToolsChange, projectId, tools],
  );

  useEffect(() => {
    socketClient.on('mcp_status', handleMcpStatusEvent);
    return () => socketClient.off('mcp_status', handleMcpStatusEvent);
  }, [socketClient, handleMcpStatusEvent]);
}
