/**
 * Two small pure predicates extracted from Part 3 hooks that were otherwise
 * judged too feature/chat-specific to promote whole (see the promotion
 * report for the full per-hook rationale on all 9 Part-3 files).
 */

/**
 * `apps/elitea-ui/src/hooks/application/useAgentAttachments.js`'s
 * `disableAttachments` computation — "attachments are enabled only when
 * `'attachments'` is present in the version's `meta.internal_tools`". The
 * rest of that hook (`useAttachmentState`, clear-on-version-switch,
 * clear-on-disable side effects) is chat-feature machinery with no
 * Application-domain content and is NOT promoted — see the report.
 */
export function isAttachmentsEnabled(internalTools: readonly string[] | undefined): boolean {
  return internalTools?.includes('attachments') ?? false;
}

/** The subset of an `mcp_status` socket payload this selector needs. */
export interface McpStatusEvent {
  readonly type: string;
  readonly connected: boolean;
}

/**
 * `apps/elitea-ui/src/hooks/application/useAgentMCPToolsStatusMonitor.js`'s
 * core transform: given a version's `tools[]` and an `mcp_status` socket
 * event, return a new tools array with the matching tool's `online` flag
 * updated. Generic over `T` (rather than importing a concrete tool type) so
 * it works equally against `VersionToolRef`
 * (`shared/api/generated/model/versionToolRef.zod.ts` — which itself has no
 * `online` field; it is a client-only augmentation, same as the baseline)
 * or any local tool shape a caller already has. The socket subscription
 * (`useSocket`) and the RTK-Query-cache-writing half of the baseline hook
 * are feature-layer orchestration, not promoted — see the report.
 */
export function applyMcpToolStatus<T extends { readonly type?: string }>(
  tools: readonly T[],
  event: McpStatusEvent,
): (T & { readonly online?: boolean })[] {
  return tools.map((tool) => (tool.type === event.type ? { ...tool, online: event.connected } : tool));
}
