import { useGetPlatformSettings } from '@/shared/api/generated/admin/admin';
import type { PlatformSettings } from '@/shared/api/generated/model';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/shared/lib/hooks/
 * useMcpVisibility.hooks.js`'s `useIsMcpVisible`. The baseline's
 * `useGetPlatformSettingsQuery` (RTK Query) becomes the generated
 * `useGetPlatformSettings` (TanStack Query) — same real endpoint
 * (`GET /platform/settings`).
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
 *
 * Kept feature-local rather than promoted to `shared/lib`: only this
 * sub-unit's `ToolBase.tsx` consumes it today (same "promote once a second
 * consumer exists" convention `features/agents/api/useIsMcpVisible.ts`
 * already documents).
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
