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
 * **The backend-contract gap this file used to document is CLOSED** (A14,
 * issue #200). It read: the baseline checks two independent flags,
 * `mcp_exposure_enabled` and `mcp_in_menu_enabled` (MCP visible unless
 * either is explicitly `false`), and the generated `PlatformSettings` had
 * neither — only a single combined `mcp_enabled`. Both are on the wire now.
 * The admin Features page's **MCP Configuration** section writes them into
 * `centry.platform_config`, and `eliteacore`'s `PlatformSettings` handler
 * marshals `mcp_enabled` and `mcp_in_menu_enabled` from those rows. So this
 * hook implements the baseline's rule rather than an approximation of it.
 *
 * `mcp_enabled` is additionally enforced SERVER-side as a 403 on the three
 * MCP proxy/sync routes, so hiding the entry points here is presentation of
 * a decision the API already makes, not the decision itself.
 */
export function useIsMcpVisible(): boolean {
  const query = useGetPlatformSettings();
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here, since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const platformSettings = query.data?.data as PlatformSettings | undefined;
  // Either flag being explicitly `false` hides MCP, which is the baseline's own
  // rule. `!== false` on each rather than `=== true`: an older deployment that
  // does not marshal `mcp_in_menu_enabled` at all must read as "in the menu",
  // not as "hidden everywhere".
  return platformSettings?.mcp_enabled !== false && platformSettings?.mcp_in_menu_enabled !== false;
}
