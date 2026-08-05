import { useGetPlatformSettings } from '@/shared/api/generated/admin/admin';
import type { PlatformSettings } from '@/shared/api/generated/model';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/shared/lib/hooks/
 * useMcpVisibility.hooks.js`'s `useIsMcpVisible`.
 *
 * **Deliberate 4th duplicate, not a promotion.** This exact hook has
 * already been ported feature-locally three times in this app
 * (`features/agents/api/useIsMcpVisible.ts`, `features/toolkits/api/
 * useIsMcpVisible.ts`, `features/pipelines/api/useIsMcpVisible.ts`) — each
 * with its own "kept feature-local ... promote once a second consumer
 * exists" doc comment, because `no-sideways-features` forbids
 * `features/chat-input` from importing any of the three. Same call here:
 * `useSlashMention.ts` (this slice's only consumer) needs the toolkit-vs-
 * MCP visibility gate the baseline's `useSlashMention.hooks.js` reads via
 * `useIsMcpVisible()`, and there is no legal shared home to reach it from
 * — see `entities/toolkit`'s own doc comments for the parallel promotion-
 * candidate flagging convention this follows.
 *
 * **Real, documented backend-contract gap (identical to the other three
 * copies).** The baseline checks TWO independent flags,
 * `mcp_exposure_enabled` and `mcp_in_menu_enabled` (MCP visible unless
 * either is explicitly `false`). The generated `PlatformSettings` schema
 * has neither field — only a single combined `mcp_enabled: boolean`. This
 * reads the one real flag that exists: MCP is visible unless `mcp_enabled`
 * is explicitly `false`.
 */
export function useIsMcpVisible(): boolean {
  const query = useGetPlatformSettings();
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here, since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const platformSettings = query.data?.data as PlatformSettings | undefined;
  return platformSettings?.mcp_enabled !== false;
}
