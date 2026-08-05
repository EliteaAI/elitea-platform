import { useEffect, useMemo, useState } from 'react';

import { useColorScheme } from '@mui/material/styles';

import { useGetApplication } from '@/shared/api/generated/applications/applications';
import type { ApplicationDetail } from '@/shared/api/generated/model';

import { useSelectedProjectId } from './useSelectedProjectId';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Converts the route's `:appId` string param into the numeric id
 * `useGetApplication` requires. Deliberately does NOT validate digit-ness
 * (an earlier version rejected non-numeric strings back to `undefined`,
 * which fed `enabled: false` below and silently disabled the query) — a
 * bad or stale app-detail link (non-numeric `appId`) must still reach the
 * backend and come back as a real query error, exactly like the baseline
 * (`useAppDetail.hooks.js:23-26`'s `useToolkitsDetailsQuery` passes
 * `toolkitId: appId` straight through with no client-side shape check at
 * all — any rejection is the backend's to make). `Number('not-a-number')`
 * is `NaN`, which is a `number` (so `applicationId !== undefined` below
 * still holds and the query stays enabled); `NaN` embedded in the request
 * URL reliably 4xxs server-side instead of the UI going blank with no
 * loading/error indication (`pages/apps/AppDetail.tsx`'s `isFetching`/
 * `isError` branches, both already wired, now actually reachable for this
 * case).
 */
function toApplicationId(appId: string | undefined): number | undefined {
  return appId === undefined ? undefined : Number(appId);
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

export interface UseAppDetailOptions {
  /**
   * Called once when the underlying query transitions into an error state.
   * Mirrors the baseline's `useAppDetail.hooks.js:28-32` effect
   * (`toastError(buildErrorMessage(error))`) minus the toast itself: no
   * toast/notification system exists anywhere in this app yet (same
   * documented gap as `features/agents/model/useValidateApplicationVersion
   * .ts`'s identical `onError` option, which this mirrors exactly —
   * including excluding `onError` from the effect's own dependency array so
   * a new callback identity on every render doesn't refire it). Currently
   * unwired: `pages/apps/AppDetail.tsx` (outside this cluster's file scope)
   * calls `useAppDetail(params.appId)` with no second argument, so no
   * `onError` is supplied and this callback never fires in the live app
   * today. Whoever owns that page next should pass
   * `{ onError: (error) => /* real notification call *\/ }` once a real
   * toast/notification primitive exists under `shared/` — until then the
   * inline `<Alert>` `pages/apps/AppDetail.tsx` already renders on
   * `isError` remains the only user-visible signal, matching every other
   * unwired-toast gap already documented elsewhere in this codebase (see
   * `DeleteApplicationButton.tsx`'s doc comment for the established
   * precedent of this exact situation).
   */
  readonly onError?: (error: unknown) => void;
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
export function useAppDetail(appId: string | undefined, options: UseAppDetailOptions = {}): AppDetailState {
  const { onError } = options;
  const projectId = useSelectedProjectId();
  const applicationId = toApplicationId(appId);
  const { colorScheme } = useColorScheme();
  const resolvedMode = colorScheme ?? 'light';

  const query = useGetApplication(projectId ?? '', applicationId ?? 0, {
    query: { enabled: projectId !== undefined && applicationId !== undefined },
  });
  // `.data.data`'s declared type includes the error-envelope variant —
  // never actually reachable here since `eliteaFetch` throws instead of
  // resolving with it (mutator.ts's §3.6 unwrap contract).
  const detail = query.data?.data as ApplicationDetail | undefined;

  useEffect(() => {
    if (query.isError) {
      onError?.(query.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onError` intentionally excluded, matching `useValidateApplicationVersion.ts`'s identical effect and the baseline's own `useAppDetail.hooks.js:28-32` (fires on isError/error change, not on every render/identity change of the callback).
  }, [query.isError, query.error]);

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
