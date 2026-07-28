import { useGetPlatformSettings } from '@/shared/api/generated/admin/admin';
import type { PlatformSettings } from '@/shared/api/generated/model';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/shared/lib/hooks/
 * useMcpVisibility.hooks.js`'s `useIsMcpVisible`. The baseline's
 * `useGetPlatformSettingsQuery` (RTK Query) becomes the generated
 * `useGetPlatformSettings` (TanStack Query) — same real endpoint
 * (`GET /platform/settings`).
 *
 * **Real, documented backend-contract gap.** The baseline checks TWO
 * independent flags, `mcp_exposure_enabled` and `mcp_in_menu_enabled`
 * (MCP visible unless either is explicitly `false`). The generated
 * `PlatformSettings` schema (`shared/api/generated/model/
 * platformSettings.zod.ts`, derived from `eliteacore/handler.go:52-63`) has
 * neither field — only a single combined `mcp_enabled: boolean`. Rather than
 * inventing the two-flag split the Go handler does not marshal, this reads
 * the one real flag that exists: MCP is visible unless `mcp_enabled` is
 * explicitly `false`. A caller that needs the baseline's finer-grained
 * "exposed but hidden from the nav menu" distinction has no wire data to
 * derive it from today.
 *
 * Kept feature-local rather than promoted to `shared/lib`: only this
 * sub-unit's `ApplicationTools`/`useAvailableInternalTools` consume it today
 * (same "promote once a second consumer exists" convention this worktree's
 * other feature-local hooks already document).
 */
export function useIsMcpVisible(): boolean {
  const query = useGetPlatformSettings();
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here, since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const platformSettings = query.data?.data as PlatformSettings | undefined;
  return platformSettings?.mcp_enabled !== false;
}
