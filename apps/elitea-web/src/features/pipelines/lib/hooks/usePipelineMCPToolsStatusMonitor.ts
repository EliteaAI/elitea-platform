/**
 * Local duplicate of `apps/elitea-ui/src/hooks/application/
 * useAgentMCPToolsStatusMonitor.js`, scoped to `features/pipelines`.
 *
 * Not in the preamble's explicit four-hooks "duplicate locally" list, but
 * the same class of dependency: `ConfigurationTab.jsx` (this domain's own
 * owned file, `pages/Pipelines/Components/ConfigurationTab.jsx:19,51`) calls
 * this EXACT SAME `hooks/application/*` file the agents domain's
 * `ConfigurationTab.jsx` also calls — it is a shared "application" hook
 * (despite the "Agent" in its name), not agent-specific, matching the
 * mission preamble's own precedent for a Pipeline being "literally an
 * Application row". `features/agents/lib/useAgentMCPToolsStatusMonitor.ts`
 * (Wave-2 unit A1e) already ported this exact baseline file faithfully;
 * this file reproduces that same port (not a re-derivation), renamed to
 * avoid an "Agent"-only name on a pipelines-owned file, and NOT imported
 * from `features/agents` (`no-sideways-features` forbids it).
 *
 * See that file's own doc comment for the two disclosed deviations this
 * port carries forward unchanged:
 *  1. Formik + Redux -> a single injected `onToolsChange` callback (this app
 *     has neither Formik nor Redux/RTK Query).
 *  2. The baseline's raw `useSocket(sioEvents.mcp_status, handler)` -> unit
 *     S5's typed `useSocketClient().on('mcp_status', handler)`/`.off(...)`.
 *
 * `applyMcpToolStatus` is reused from the promoted `entities/
 * application-form` (legal: freely importable from `features/`), not
 * re-implemented.
 */
import { useCallback, useEffect, useMemo } from 'react';

import { applyMcpToolStatus } from '@/entities/application-form';
import { useSocketClient } from '@/shared/api/socket/client';
import type { ReceivePayloadOf } from '@/shared/api/socket/events';

export interface PipelineMcpToolLike {
  readonly type?: string;
}

export interface UsePipelineMCPToolsStatusMonitorParams<T extends PipelineMcpToolLike> {
  /** The version currently being edited/viewed's tools array. */
  readonly tools: readonly T[] | undefined;
  /** The project this form belongs to — events for any OTHER project are ignored. */
  readonly projectId: string | undefined;
  /** Called with the recomputed tools array whenever a relevant `mcp_status` event arrives. */
  readonly onToolsChange: (nextTools: readonly (T & { readonly online?: boolean })[]) => void;
}

function hasMcpTool<T extends PipelineMcpToolLike>(tools: readonly T[] | undefined): boolean {
  return (tools ?? []).some((tool) => Boolean((tool as { readonly meta?: { readonly mcp?: unknown } }).meta?.mcp));
}

export function usePipelineMCPToolsStatusMonitor<T extends PipelineMcpToolLike>({
  tools,
  projectId,
  onToolsChange,
}: UsePipelineMCPToolsStatusMonitorParams<T>): void {
  const socketClient = useSocketClient();
  const isMcp = useMemo(() => hasMcpTool(tools), [tools]);

  const handleMcpStatusEvent = useCallback(
    (event: ReceivePayloadOf<'mcp_status'>) => {
      if (!isMcp) return;
      const { type, connected, project_id: eventProjectId } = event;
      if (type === undefined || connected === undefined) return;
      if (projectId !== undefined && eventProjectId !== undefined && String(eventProjectId) !== projectId) return;
      onToolsChange(applyMcpToolStatus(tools ?? [], { type, connected }));
    },
    [isMcp, onToolsChange, projectId, tools],
  );

  useEffect(() => {
    socketClient.on('mcp_status', handleMcpStatusEvent);
    return () => socketClient.off('mcp_status', handleMcpStatusEvent);
  }, [socketClient, handleMcpStatusEvent]);
}
