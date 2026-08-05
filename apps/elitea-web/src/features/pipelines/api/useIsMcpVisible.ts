import { useGetPlatformSettings } from '@/shared/api/generated/admin/admin';
import type { PlatformSettings } from '@/shared/api/generated/model';

/**
 * Local duplicate of `features/agents/api/useIsMcpVisible.ts`, itself
 * ported from `apps/elitea-ui/src/[fsd]/shared/lib/hooks/
 * useMcpVisibility.hooks.js`'s `useIsMcpVisible`. Duplicated, not
 * imported: `no-sideways-features` forbids `features/pipelines` reaching
 * into `features/agents`. Needed by this sub-unit's `ToolSelect.jsx` port
 * (baseline: `ToolSelect.jsx:25,35` -- `useIsMcpVisible` gates whether MCP
 * toolkit entries are filtered out of the toolkit dropdown).
 *
 * **Real, documented backend-contract gap** (see the agents-slice file's
 * own doc comment for the full account, not repeated verbatim): the
 * baseline checks two independent flags (`mcp_exposure_enabled` /
 * `mcp_in_menu_enabled`); the generated `PlatformSettings` schema has only
 * one combined `mcp_enabled` boolean. This reads the one real flag that
 * exists.
 */
export function useIsMcpVisible(): boolean {
  const query = useGetPlatformSettings();
  // `.data.data`'s declared type includes the error-envelope variant --
  // never actually reachable here, since `eliteaFetch` throws instead of
  // resolving with it (mutator.ts's §3.6 unwrap contract).
  const platformSettings = query.data?.data as PlatformSettings | undefined;
  return platformSettings?.mcp_enabled !== false;
}
