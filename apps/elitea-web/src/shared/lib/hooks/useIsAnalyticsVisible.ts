/**
 * The platform's Analytics visibility switch — ported off Configuration's
 * withheld `observability` section onto the admin Features page.
 *
 * ## Where this came from
 *
 * `analytics_enabled` used to be a field on the Configuration page's
 * `observability` section (`analytics.enabled`), and that whole section was
 * REMOVED rather than ported: its other two fields addressed things this
 * platform cannot govern from a database row (a per-process env var, a table
 * with no writer) — see `services/elitea-main/internal/api/v2/admin/
 * config_schemas.go`'s "Observability, Runtime and Admin Panel are GONE too"
 * note. This one field was different: it is an ordinary
 * `centry.platform_config` flag of exactly the shape `mcp_in_menu` and the
 * voice-feature switches are, so it moved to the Features page instead of
 * disappearing with its old section.
 *
 * ## Reading, not the whole gate
 *
 * This hides the Settings > Analytics tab and its route — the client half.
 * The flag is ALSO enforced server-side: `internal/api/router.go`'s
 * `requireAnalyticsEnabled` refuses every `/analytics*` route with a 403 when
 * it is off, the same shape `mcp_enabled` takes on the MCP proxy/sync routes.
 * A hidden tab over an open endpoint would be no gate at all — this hook is
 * only the half that decides what renders.
 *
 * `analytics_enabled` is not yet a named field in the generated
 * `PlatformSettings` model (unlike `mcp_in_menu_enabled` and
 * `voice_features_enabled`, which went through a spec edit of their own).
 * `PlatformSettings` declares `additionalProperties: true` precisely so a
 * field can arrive on the wire ahead of that edit — see `handler.go`'s note
 * on the MCP pair — so this reads it through an inline cast rather than
 * widening the generated type.
 */
import { useGetPlatformSettings } from '@/shared/api/generated/admin/admin';
import type { PlatformSettings } from '@/shared/api/generated/model';

export function useIsAnalyticsVisible(): boolean {
  const query = useGetPlatformSettings();
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here, since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const settings = query.data?.data as (PlatformSettings & { analytics_enabled?: boolean }) | undefined;
  // `!== false`, not `=== true`: while the query is in flight, and on a
  // deployment old enough not to marshal this key at all, the answer must be
  // "visible" — a database hiccup or an older backend must not silently take
  // the tab away from every operator.
  return settings?.analytics_enabled !== false;
}
