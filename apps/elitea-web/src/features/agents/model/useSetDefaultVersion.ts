import { useCallback, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { getSetApplicationDefaultVersionQueryOptions } from '@/shared/api/generated/applications/applications';
import type { OkResponse } from '@/shared/api/generated/model';

import { applicationErrorMessage } from '../lib/errorMessage';

/**
 * Port of `apps/elitea-ui/src/[fsd]/entities/version/lib/hooks/
 * useSetDefaultVersion.hooks.jsx` — the data half of #147 ("the agent version
 * menu has no set-default item"). The route, the handler and the generated
 * client all existed; nothing called them.
 *
 * `PATCH /elitea_core/default_version/prompt_lib/{projectId}/{applicationId}/
 * {versionId}` → `SetDefaultVersion`
 * (`services/elitea-main/internal/api/v2/applications/handler.go:1202-1225`)
 * → `ApplicationsRepo.SetDefaultVersion`
 * (`internal/infra/db/repos/applications.go:650-682`), read in full:
 *
 *  - The version id travels in the PATH. The optional body `{"version_id":
 *    "..."}` OVERRIDES it and exists for old-SPA compatibility only
 *    (:1206-1213); this hook sends no body, so the path segment decides. The
 *    baseline sends the 3-segment form with the id in the body, which the Go
 *    router answers with a 405 — that shape is deliberately not ported.
 *  - The repo refuses a version that does not belong to this application
 *    (404 "version not found") and an application that does not exist (404),
 *    so a wrong id fails loudly rather than writing a dangling reference.
 *  - Success writes `applications.meta.default_version_id` and answers
 *    `{"ok": true}`.
 *
 * **`staleTime: 0` is load-bearing, not decoration.** The generated client
 * models this PATCH as a QUERY, so it goes through `queryClient.fetchQuery`,
 * and the app's own client sets `staleTime: 30_000`
 * (`app/providers/queryClient.ts:101`). Without the override, setting the
 * default to version A, then to B, then back to A inside 30 seconds would
 * replay A's cache entry and send NO second request, while still reporting
 * success.
 *
 * **No toast, no cache surgery, no navigation** — same caller-owns-
 * orchestration posture as `useDeleteVersion`/`useSaveNewVersion`. The
 * baseline patches its RTK-Query detail cache to record the new default
 * because it can: its detail response carries `meta.default_version_id`. The
 * Go `Get` handler does NOT emit `meta` at all
 * (`applications/handler.go:121-152` builds the response map by hand from
 * seven keys), and `ApplicationDetail`/`ApplicationVersionSummary` carry no
 * `is_default` either, so there is nothing here to invalidate: the caller
 * remembers the id it just set. See `AgentVersionControls` for what that
 * costs on screen.
 */
export interface UseSetDefaultVersionInput {
  readonly projectId: string;
  readonly applicationId: number;
}

export interface UseSetDefaultVersionResult {
  readonly doSetDefaultVersion: (versionId: number) => Promise<boolean>;
  readonly isSettingDefaultVersion: boolean;
  readonly error: unknown;
  readonly errorMessage: string | undefined;
  /**
   * Drops a refusal the caller has finished showing — the baseline's own
   * `reset()` (`useSetDefaultVersion.hooks.jsx:79,87`). Without it a caller
   * that keeps this hook mounted across dialog openings (the version bar
   * does) re-shows the previous attempt's error the moment the dialog opens
   * again, before anything has been sent.
   */
  readonly resetError: () => void;
}

export function useSetDefaultVersion(input: UseSetDefaultVersionInput): UseSetDefaultVersionResult {
  const queryClient = useQueryClient();
  const [isSettingDefaultVersion, setIsSettingDefaultVersion] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  const doSetDefaultVersion = useCallback(
    async (versionId: number): Promise<boolean> => {
      setIsSettingDefaultVersion(true);
      setError(undefined);
      try {
        const options = getSetApplicationDefaultVersionQueryOptions(input.projectId, input.applicationId, versionId);
        const response = await queryClient.fetchQuery({ ...options, staleTime: 0 });
        return (response as { data: OkResponse }).data.ok;
      } catch (caught) {
        setError(caught);
        return false;
      } finally {
        setIsSettingDefaultVersion(false);
      }
    },
    [input.applicationId, input.projectId, queryClient],
  );

  const resetError = useCallback(() => setError(undefined), []);

  return {
    doSetDefaultVersion,
    isSettingDefaultVersion,
    error,
    errorMessage: error === undefined ? undefined : applicationErrorMessage(error),
    resetError,
  };
}
