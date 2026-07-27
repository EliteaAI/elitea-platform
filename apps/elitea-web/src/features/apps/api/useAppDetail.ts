import { useEffect, useMemo, useState } from 'react';

import { useColorScheme } from '@mui/material/styles';

import { useGetApplication } from '@/shared/api/generated/applications/applications';
import type { ApplicationDetail } from '@/shared/api/generated/model';

import { useSelectedProjectId } from './useSelectedProjectId';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseApplicationId(appId: string | undefined): number | undefined {
  if (appId === undefined || !/^\d+$/.test(appId)) return undefined;
  return Number(appId);
}

/**
 * `versionDetails.meta.custom_ui_route` / `.provider` — the baseline's
 * `appData?.meta?.custom_ui_route` / `appData?.provider`
 * (`useAppDetail.hooks.js:35-47`).
 *
 * **Real backend-capability gap, not a porting shortcut:** neither
 * `custom_ui_route` nor a proxy for the baseline's `/ui_host/{provider}/...`
 * route appears ANYWHERE in `services/elitea-main`'s Go source
 * (`grep -rn "custom_ui_route\|ui_host" --include="*.go" services/` — zero
 * hits both ways, checked directly against the backend this app talks to).
 * Both belong to the legacy pylon PLUGIN runtime (e.g.
 * `legacy/plugins/deepwiki_plugin`'s own `static/ui/`) — exactly the
 * "no plugin loading" architecture this platform's Go rewrite deliberately
 * drops (root `CLAUDE.md`'s AGENTS.md guardrails). `versionDetails.meta` IS
 * read defensively below (never assumed absent) so that if a future Go
 * handler ever populates it, this port picks it up with no code change —
 * but on the CURRENT backend `hasCustomUI` is always `false` in practice,
 * and every real hit falls through to the non-custom-UI branch
 * (`pages/apps/AppDetail.tsx`'s `EditToolkit` composition gap — see that
 * file's own doc comment).
 */
function readMetaString(detail: ApplicationDetail | undefined, key: string): string | null {
  // Generated model field names are snake_case (mirrors the Go JSON tags
  // directly, `applicationDetail.zod.ts`'s `version_details`) — NOT
  // `entities/application`'s camelCased `ApplicationDetail.versionDetails`,
  // which this hook does not use.
  const meta: unknown = detail?.version_details?.meta;
  if (!isRecord(meta)) return null;
  const value = meta[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export interface AppDetailState {
  readonly appName: string;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly iframeUrl: string | null;
  readonly iframeKey: number;
  readonly hasCustomUI: boolean;
}

/**
 * Replaces the baseline's `useAppDetail`
 * (`features/apps/lib/hooks/useAppDetail.hooks.js`). `appId` is passed in
 * (rather than read from the route internally) so this hook stays testable
 * without a router — `pages/apps/AppDetail.tsx` reads the `:appId` param
 * via TanStack Router's generic `useParams({ strict: false })` and forwards
 * it, matching spec §3.2's "pages never fetch, data enters via a features/
 * hook" split (the page still owns no fetching logic of its own).
 */
export function useAppDetail(appId: string | undefined): AppDetailState {
  const projectId = useSelectedProjectId();
  const applicationId = parseApplicationId(appId);
  const { colorScheme } = useColorScheme();
  const resolvedMode = colorScheme ?? 'light';

  const query = useGetApplication(projectId ?? '', applicationId ?? 0, {
    query: { enabled: projectId !== undefined && applicationId !== undefined },
  });
  // `.data.data`'s declared type includes the error-envelope variant —
  // never actually reachable here since `eliteaFetch` throws instead of
  // resolving with it (mutator.ts's §3.6 unwrap contract).
  const detail = query.data?.data as ApplicationDetail | undefined;

  const customUIRoute = useMemo(() => readMetaString(detail, 'custom_ui_route'), [detail]);
  const provider = useMemo(() => readMetaString(detail, 'provider'), [detail]);

  const [iframeKey, setIframeKey] = useState(0);
  // `useAppDetail.hooks.js:38-43` — "Reload iframe when theme changes":
  // fires on mount too (once `customUIRoute` first resolves truthy), not
  // only on a genuine later change, since that is what a bare
  // `useEffect(fn, [mode, customUIRoute])` does in the baseline as well.
  useEffect(() => {
    if (customUIRoute !== null) {
      setIframeKey((key) => key + 1);
    }
  }, [resolvedMode, customUIRoute]);

  const iframeUrl = useMemo(() => {
    if (customUIRoute === null || provider === null || projectId === undefined || appId === undefined) {
      return null;
    }
    const params = new URLSearchParams({ theme: resolvedMode, toolkit_id: appId });
    return `/ui_host/${provider}/${customUIRoute}/${projectId}/?${params.toString()}`;
  }, [customUIRoute, provider, projectId, appId, resolvedMode]);

  return {
    appName: detail?.name ?? 'Application',
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    iframeUrl,
    iframeKey,
    hasCustomUI: iframeUrl !== null,
  };
}
