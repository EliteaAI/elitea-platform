import { useCallback, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import {
  getCreateApplicationQueryOptions,
  getUpdateApplicationVersionQueryOptions,
} from '@/shared/api/generated/applications/applications';
import type {
  ApplicationCreateRequest,
  ApplicationCreatedResponse,
  ApplicationVersionDetail,
  VersionWriteRequest,
} from '@/shared/api/generated/model';

import type { ApplicationVersionDraft } from './initialValues';

/**
 * `mutations.ts` — the generic create/save halves of the baseline's
 * `useCreateApplication.jsx` and `useSaveVersion.js`
 * (`apps/elitea-ui/src/hooks/application/`), rebuilt against this app's
 * generated TanStack Query client instead of RTK Query.
 *
 * **Why these two hooks and not a faithful line-by-line port:** both
 * baseline hooks are transitive dependencies of the 7 promoted Part 1
 * files (`CreateApplicationTabBar`/`CreateApplicationSaveButton` call
 * `useCreateApplication`; `SaveApplicationButton` calls `useSaveVersion` via
 * `useSaveVersion.js`) but were NOT themselves named in the promotion
 * brief's file list. Reading them in full turned up that they are soaked in
 * things this promotion pass has no business carrying into `entities/`:
 * Formik context, Redux (`useSelector`/`dispatch`, `slices/pipeline`,
 * `eliteaApi.util.updateQueryData`), toast, react-router navigation, and —
 * for the pipeline path — `features/pipelines/flow-editor` node/edge
 * calculation. None of that is "Application entity" domain logic; it is
 * page/feature orchestration, and `entities/` may not import
 * `features/`/`pages/` (`no-upward-from-entities`) even if it were.
 *
 * What's genuinely generic and IS ported: turning a plain, typed draft
 * object into the two real generated endpoints' request bodies, and
 * exposing an imperative `create`/`save` function plus loading/error state
 * with no Formik/Redux/router coupling — exactly the split
 * `features/credentials/ui/CredentialsTabBar.tsx`'s own "DISCLOSED
 * REDESIGN" doc comment already established as this codebase's convention
 * for this situation.
 *
 * Orval generated EVERY endpoint here (including the POSTs/PUTs) as a
 * `useQuery`-shaped hook, not `useMutation` — confirmed by reading
 * `applications.ts` directly (`useCreateApplication`/
 * `useUpdateApplicationVersion` both return `UseQueryResult`, gated by
 * `enabled`). The established imperative-trigger convention for this shape
 * is `queryClient.fetchQuery(getXQueryOptions(...))`, not calling the query
 * hook itself — see `features/apps/api/useModerationRequests.ts`'s
 * `submitRequest`, the first Wave-2 unit to hit this pattern.
 */

function toVersionWriteRequest(draft: ApplicationVersionDraft): VersionWriteRequest {
  return {
    name: draft.name,
    ...(draft.agentType !== undefined ? { agent_type: draft.agentType } : {}),
    instructions: draft.instructions,
    conversation_starters: [...draft.conversationStarters],
    variables: draft.variables.map((variable) => ({ name: variable.name, value: variable.value })),
    meta: { ...draft.meta },
  };
}

export interface ApplicationDraftInput {
  readonly name: string;
  readonly description?: string;
  readonly type?: string;
  readonly icon?: string;
  readonly version?: ApplicationVersionDraft;
}

export interface UseCreateApplicationDraftResult {
  readonly create: (draft: ApplicationDraftInput) => Promise<ApplicationCreatedResponse | undefined>;
  readonly isCreating: boolean;
  readonly error: unknown;
}

/**
 * Imperative "create a new application shell" action, backed by the real
 * `POST /elitea_core/applications/prompt_lib/{projectId}` endpoint
 * (`useCreateApplication` in `shared/api/generated/applications/
 * applications.ts`). Returns `undefined` (without calling the network) when
 * `projectId` is not yet resolved — the caller decides what "no project"
 * means for its UI, this hook just refuses to fire a request with a blank
 * project id.
 *
 * `webhook_secret` — sent by the baseline's `useCreateApplication.jsx` on
 * every create call — has no field on the generated `ApplicationCreateRequest`
 * (checked directly against `applicationCreateRequest.zod.ts`); dropped
 * here rather than invented, same as the `tags`/`tools`/`pipeline_settings`
 * gap documented on `ApplicationVersionDraft`.
 */
export function useCreateApplicationDraft(projectId: string | undefined): UseCreateApplicationDraftResult {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  const create = useCallback(
    async (draft: ApplicationDraftInput): Promise<ApplicationCreatedResponse | undefined> => {
      if (projectId === undefined) return undefined;
      setIsCreating(true);
      setError(undefined);
      try {
        const body: ApplicationCreateRequest = {
          name: draft.name,
          ...(draft.description !== undefined ? { description: draft.description } : {}),
          ...(draft.type !== undefined ? { type: draft.type } : {}),
          ...(draft.icon !== undefined ? { icon: draft.icon } : {}),
          ...(draft.version !== undefined ? { versions: [toVersionWriteRequest(draft.version)] } : {}),
        };
        const options = getCreateApplicationQueryOptions(projectId, body);
        const response = await queryClient.fetchQuery(options);
        // `response.data`'s declared type includes the error-envelope
        // variants (400/401/403) — never actually reachable here since
        // `eliteaFetch` throws `EliteaApiError` instead of resolving with
        // them (mutator.ts's §3.6 unwrap contract; same cast convention as
        // `features/apps/api/useAppDetail.ts`).
        return (response as { data: ApplicationCreatedResponse }).data;
      } catch (caught) {
        setError(caught);
        return undefined;
      } finally {
        setIsCreating(false);
      }
    },
    [projectId, queryClient],
  );

  return { create, isCreating, error };
}

export interface UseSaveApplicationVersionResult {
  readonly save: (draft: ApplicationVersionDraft) => Promise<ApplicationVersionDetail | undefined>;
  readonly isSaving: boolean;
  readonly error: unknown;
}

/**
 * Imperative "save this application/pipeline version's mutable fields"
 * action, backed by `PUT /elitea_core/version/prompt_lib/{projectId}/
 * {applicationId}/{versionId}` (`useUpdateApplicationVersion`).
 *
 * **Real, documented contract gap:** the baseline's `useSaveVersion.js`
 * also writes `tags`, `tools`, and (for pipelines) `pipeline_settings` in
 * the SAME PUT call. `VersionWriteRequest` — the generated body type for
 * this exact endpoint — has no field for any of the three (verified
 * against `versionWriteRequest.zod.ts`: `name`, `agent_type`,
 * `instructions`, `welcome_message`, `llm_settings`,
 * `conversation_starters`, `variables`, `meta`, nothing else). This hook
 * only sends what the endpoint can actually carry; a caller that needs to
 * change a version's tools must currently go through
 * `useDeleteApplicationTool` (removal) plus a toolkit-association endpoint
 * (addition) instead of one combined PUT, and there is currently no
 * generated endpoint at all for `pipeline_settings` or `tags` on a version.
 * Flagged, not invented — see the promotion pass's final report for the
 * full list of these gaps.
 */
export function useSaveApplicationVersion(
  projectId: string | undefined,
  applicationId: number | undefined,
  versionId: number | undefined,
): UseSaveApplicationVersionResult {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  const save = useCallback(
    async (draft: ApplicationVersionDraft): Promise<ApplicationVersionDetail | undefined> => {
      if (projectId === undefined || applicationId === undefined || versionId === undefined) return undefined;
      setIsSaving(true);
      setError(undefined);
      try {
        const options = getUpdateApplicationVersionQueryOptions(
          projectId,
          applicationId,
          versionId,
          toVersionWriteRequest(draft),
        );
        const response = await queryClient.fetchQuery(options);
        // Invalidating any GET-side cache (application detail, version
        // detail) is deliberately left to the caller: this hook only knows
        // the PUT it just issued, not which read queries a given feature
        // keeps around for this application/version.
        // Same error-envelope-unreachable cast as `useCreateApplicationDraft` above.
        return (response as { data: ApplicationVersionDetail }).data;
      } catch (caught) {
        setError(caught);
        return undefined;
      } finally {
        setIsSaving(false);
      }
    },
    [projectId, applicationId, versionId, queryClient],
  );

  return { save, isSaving, error };
}
