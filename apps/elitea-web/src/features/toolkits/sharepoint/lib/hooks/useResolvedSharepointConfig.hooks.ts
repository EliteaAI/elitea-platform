import { useEffect, useMemo, useState } from 'react';

import { useRouteContext } from '@tanstack/react-router';

import { getConfigurationsByType } from '../api/configurations';
import type { ConfigurationWire } from '../api/configurations';
import { getSharepointConnectionTokenKey } from '../helpers/token.helpers';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/sharepoint/lib/hooks/
 * useResolvedSharepointConfig.hooks.js` (Wave-2 unit A4e).
 *
 * DISCLOSED REDESIGN, two changes, both the same "ambient global state ->
 * explicit seam" convention this session's every other unit already
 * applies:
 *
 *  1. **No RTK Query cache.** `useGetConfigurationsByTypeQuery` (RTK Query,
 *     tag-invalidated, auto-refetching) has no equivalent — this app has no
 *     Redux/RTK Query dependency (see `../api/configurations.ts`'s own doc
 *     comment). Fetches once per `(eliteaTitle, credProjectId)` pair via a
 *     plain `useEffect` + local state — same "no cache, direct call" shape
 *     `useSharepointCheckConnection.hooks.ts` (a genuinely imperative,
 *     never-cached RTK mutation in the baseline too) already has to use.
 *  2. **No `useSelector(state => state.user)`.** `personal_project_id`
 *     comes from the TanStack Router root context's `auth.getUser()`
 *     (`src/app/router-context.ts`'s `AuthUser.personal_project_id` — the
 *     SAME seam `features/toolkits/lib/hooks/useSelectedProjectId.ts`
 *     already reads `getSelectedProjectId()` from), structurally typed
 *     rather than importing `src/app/router-context.ts` directly, per that
 *     file's own "no `app/`-layer import from `features/`" reasoning
 *     (`no-upward-from-features`).
 */
interface PersonalProjectIdContext {
  readonly auth?: {
    readonly getUser?: () => { readonly personal_project_id?: string } | undefined;
  };
}

function isPersonalProjectIdContext(value: unknown): value is PersonalProjectIdContext {
  return typeof value === 'object' && value !== null;
}

/** Pure extraction, unit-tested directly — mirrors `useSelectedProjectId.ts`'s own `selectProjectId`. */
export function selectPersonalProjectId(context: unknown): string | undefined {
  if (!isPersonalProjectIdContext(context)) return undefined;
  return context.auth?.getUser?.()?.personal_project_id;
}

/** The subset of a resolved SharePoint credential's `data` this app reads — `oauth_discovery_endpoint`/`site_url` gate the delegated-vs-header-auth branch, `client_id`/`client_secret`/`scopes` feed the OAuth modal. */
export interface SharepointResolvedConfig {
  readonly oauth_discovery_endpoint?: string;
  readonly site_url?: string;
  readonly client_id?: string;
  readonly client_secret?: string;
  readonly scopes?: string | readonly string[];
  readonly configuration_uuid: string | undefined;
  readonly [key: string]: unknown;
}

/** The `settings.sharepoint_configuration` reference a toolkit's form values carry — an `elitea_title` naming the credential, plus a `private` flag selecting which project's credential list to search. */
export interface SharepointConfigRef {
  readonly elitea_title?: string;
  readonly private?: boolean;
}

export interface UseResolvedSharepointConfigResult {
  readonly spConfig: SharepointResolvedConfig | null;
  readonly oauthEndpoint: string;
  readonly configUuid: string | undefined;
  readonly oauthTokenKey: string;
  readonly connectionTokenKey: string | undefined;
}

function resolveCredential(
  items: readonly ConfigurationWire[] | undefined,
  eliteaTitle: string | undefined,
): ConfigurationWire | undefined {
  return items?.find((item) => item.elitea_title === eliteaTitle);
}

export function useResolvedSharepointConfig(
  spConfigRef: SharepointConfigRef | undefined,
  projectId: string | undefined,
): UseResolvedSharepointConfigResult {
  const context: unknown = useRouteContext({ strict: false });
  const personalProjectId = selectPersonalProjectId(context);

  const eliteaTitle = spConfigRef?.elitea_title;
  const credProjectId = spConfigRef?.private ? personalProjectId : projectId;

  const [items, setItems] = useState<readonly ConfigurationWire[] | undefined>(undefined);

  useEffect(() => {
    // Baseline (`useResolvedSharepointConfig.hooks.js:16`): RTK Query's
    // `{ skip: !eliteaTitle || !credProjectId }` — falsy, not nullish-only.
    // An empty-string `eliteaTitle`/`credProjectId` must also skip the
    // fetch (an empty `credProjectId` would otherwise build an invalid
    // `/configurations/configurations/` URL).
    if (!eliteaTitle || !credProjectId) {
      setItems(undefined);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    getConfigurationsByType(credProjectId, 'sharepoint', controller.signal)
      .then((page) => {
        if (!cancelled) setItems(page.items);
      })
      .catch(() => {
        if (!cancelled) setItems(undefined);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [credProjectId, eliteaTitle]);

  const resolvedCred = useMemo(() => resolveCredential(items, eliteaTitle), [items, eliteaTitle]);

  const spConfig = useMemo<SharepointResolvedConfig | null>(() => {
    if (!resolvedCred?.data) return null;
    return { ...resolvedCred.data, configuration_uuid: resolvedCred.uuid ?? resolvedCred.uid };
  }, [resolvedCred]);

  const oauthEndpoint = spConfig?.oauth_discovery_endpoint ?? '';
  const configUuid = spConfig?.configuration_uuid;
  const siteUrl = spConfig?.site_url ?? '';
  const oauthTokenKey = configUuid && oauthEndpoint ? `${configUuid}:${oauthEndpoint}` : oauthEndpoint;
  const connectionTokenKey = getSharepointConnectionTokenKey({ oauthEndpoint, configUuid, siteUrl });

  return { spConfig, oauthEndpoint, configUuid, oauthTokenKey, connectionTokenKey };
}
