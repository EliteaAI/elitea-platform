import { useGetPlatformSettings } from '@/shared/api/generated/admin/admin';
import type { PlatformSettings } from '@/shared/api/generated/model';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/shared/lib/hooks/
 * useMcpVisibility.hooks.js`'s `useIsMcpVisible`. The baseline's
 * `useGetPlatformSettingsQuery` (RTK Query) becomes the generated
 * `useGetPlatformSettings` (TanStack Query) — same real endpoint
 * (`GET /platform/settings`).
 *
 * **Real, documented backend-contract gap** (identical to `features/agents/
 * api/useIsMcpVisible.ts`'s own doc comment, restated here since this is an
 * independent copy, not a shared import — `no-sideways-features` forbids
 * `features/toolkits` importing `features/agents`). The baseline checks TWO
 * independent flags, `mcp_exposure_enabled` and `mcp_in_menu_enabled` (MCP
 * visible unless either is explicitly `false`). The generated
 * `PlatformSettings` schema has neither field — only a single combined
 * `mcp_enabled: boolean`. This reads the one real flag that exists: MCP is
 * visible unless `mcp_enabled` is explicitly `false`.
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
  return platformSettings?.mcp_enabled !== false;
}
