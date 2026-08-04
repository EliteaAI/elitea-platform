import { useCallback, useEffect, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { getEditApplicationQueryOptions, getUpdateApplicationVersionQueryOptions } from '@/shared/api/generated/applications/applications';
import type {
  ApplicationUpdateRequest,
  ApplicationUpdatedResponse,
  ApplicationVersionDetail,
  VersionWriteRequest,
} from '@/shared/api/generated/model';

import { applicationErrorMessage } from '../lib/errorMessage';

import { useApplicationsStore } from './applicationsStore';

/**
 * Port of `apps/elitea-ui/src/hooks/application/useSaveVersion.js`.
 *
 * **DISCLOSED REDESIGN — the baseline's ONE combined PUT is genuinely TWO
 * endpoints on the real backend, traced to Go source, not assumed:**
 *
 * The baseline calls `useApplicationEditMutation()` (`applicationEdit`,
 * `PUT /application/prompt_lib/{projectId}/{id}`) with a body carrying BOTH
 * application-level fields (`name`, `description`, `owner_id`,
 * `webhook_secret`) AND a nested `version: {...version_details, llm_settings,
 * tags, tools, conversation_starters, instructions, pipeline_settings, meta}`.
 * Reading `services/elitea-main/internal/api/v2/applications/handler.go`'s
 * `Update` handler (:486-613) directly shows its nested-version branch reads
 * ONLY `version.name` (guarded against renaming `base`/`latest`) and
 * `version.instructions` — nothing else; `owner_id`/`webhook_secret` are not
 * read at the application level either (`ApplicationUpdateRequest` —
 * `applicationUpdateRequest.zod.ts` — confirms: `name`/`description`/`icon`/
 * a thin `version` stub, nothing more). The RICH version fields the baseline
 * actually needs to persist (`llm_settings`, `welcome_message`,
 * `conversation_starters`, `meta`, `agent_type`) are read by a
 * DIFFERENT handler, `UpdateVersion` (:808-930, routed at
 * `PUT /version/prompt_lib/{projectId}/{applicationId}/{versionId}`,
 * `useUpdateApplicationVersion`/`VersionWriteRequest`) — confirmed field-by-
 * field against that handler's SQL `setClauses` construction.
 *
 * **`variables` is a real, backend-side no-op on UPDATE — this frontend
 * cannot fix it.** `UpdateVersion`'s `setClauses` construction
 * (handler.go:838-877) reads `name`, `instructions`, `llm_settings`,
 * `conversation_starters`, `welcome_message`, `agent_type`, and `meta` off
 * the request body — there is no `variables` branch at all. Only
 * `CreateVersion` persists `variables` (at version-creation time).
 * Sending `input.version.variables` through `updateApplicationVersion`
 * here is accepted (201) and silently discarded — the column is never
 * touched on UPDATE. There is currently no working endpoint for a caller
 * to change an existing version's `variables` after creation.
 *
 * So this hook issues the two real calls the one baseline call used to
 * fake: `updateApplicationVersion` for the version's mutable fields, and
 * (only when `applicationName`/`applicationDescription`/`applicationIcon`
 * are supplied) `editApplication` for the application shell — WITHOUT that
 * second call's own thin `version` stub (which would only redundantly echo
 * `name`/`instructions` through a narrower path, and risks the "cannot
 * rename base/latest version" 400 guard for no benefit once
 * `updateApplicationVersion` already carries the real version update).
 *
 * **Real, disclosed gaps, not invented fields:**
 * - `tags` has no field on `VersionWriteRequest` at all (checked directly)
 *   — same gap `entities/application-form/model/mutations.ts`'s
 *   `useSaveApplicationVersion` already discloses for its own narrower call.
 * - `webhook_secret` has no field on `ApplicationUpdateRequest` — same gap
 *   `entities/application-form/model/mutations.ts`'s `useCreateApplicationDraft`
 *   discloses for CREATE; confirmed here it is equally absent on UPDATE.
 * - `pipeline_settings` has no write endpoint anywhere in the generated
 *   client — see `useCreateApplication.ts`'s doc comment point 3 for the
 *   full trace; not resent here either.
 * - Tool changes (`selected_tools`) go through `useSaveChangedTools`'s
 *   `onSaveTools` gate FIRST, exactly like the baseline's `onSave`
 *   (`useSaveVersion.js:57-60`) gates on `onSaveTools()` before its own
 *   save call — see that hook's own doc comment for why it cannot actually
 *   persist a `selected_tools` change today, and why it therefore always
 *   resolves `true` rather than blocking this PUT the way a genuine
 *   baseline failure would.
 * - The baseline also fetches `useListModelsQuery` and runs
 *   `cleanLLMSettings(llmSettings, model)` to strip fields (e.g.
 *   `reasoning_effort`) the selected model doesn't support, before sending
 *   `llm_settings`. Dropped, not silently reproduced: there is no
 *   `ListModels`-shaped endpoint anywhere under `shared/api/generated/`
 *   (same gap `entities/application-form/model/initialValues.ts` already
 *   discloses for `useCreateApplicationInitialValues`'s own `llm_settings`
 *   default), and `cleanLLMSettings` itself has no port anywhere in this
 *   tree. `input.version.llm_settings` is sent through to
 *   `updateApplicationVersion` verbatim; a caller that has resolved model
 *   capabilities by some other means must clean it before calling this hook.
 *
 * **No Formik, no Redux `state.user`/`eliteaApi.util.updateQueryData` cache
 * patch, no nav-blocker/toast/navigation** — same "plain typed input,
 * caller owns orchestration" redesign as `useCreateApplication.ts`; see that
 * file's doc comment points 1 and 4 for the precedent this follows. Any
 * caller that wants the version-detail query cache to reflect the save
 * immediately can call `queryClient.invalidateQueries` itself using
 * `getGetApplicationVersionDetailQueryOptions(...).queryKey` — this hook
 * does not reach into a cache key it doesn't own conventions for.
 */

export interface SaveVersionInput {
  readonly projectId: string;
  readonly applicationId: number;
  readonly versionId: number;
  /** Version fields — mirrors `VersionWriteRequest` exactly (see module doc for the fields that have no wire representation: `tags`, `pipeline_settings`). */
  readonly version: VersionWriteRequest;
  /** Application-shell fields — omit any of these to leave that field alone (no `editApplication` call fires at all when all three are omitted). */
  readonly applicationName?: string;
  readonly applicationDescription?: string;
  readonly applicationIcon?: string;
}

export interface SaveVersionResult {
  readonly versionDetail: ApplicationVersionDetail;
  readonly application?: ApplicationUpdatedResponse;
}

export interface UseSaveVersionResult {
  readonly onSave: (input: SaveVersionInput) => Promise<SaveVersionResult | undefined>;
  readonly isSaving: boolean;
  readonly error: unknown;
  readonly errorMessage: string | undefined;
}

function needsApplicationUpdate(input: SaveVersionInput): boolean {
  return input.applicationName !== undefined || input.applicationDescription !== undefined || input.applicationIcon !== undefined;
}

/**
 * @param onSaveTools Injected gate, matching `useSaveChangedTools`'s
 * `onSaveTools` shape exactly — pass `result.onSaveTools` from a
 * `useSaveChangedTools(...)` call made with the SAME version's current vs.
 * original `tools[]`. Omit to skip the gate entirely (e.g. a caller that
 * has no tools UI on this screen).
 */
export function useSaveVersion(onSaveTools?: () => Promise<boolean>): UseSaveVersionResult {
  const queryClient = useQueryClient();
  const setIsSaving = useApplicationsStore((state) => state.setIsSaving);
  const [isSaving, setIsSavingLocal] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    setIsSaving(isSaving);
  }, [isSaving, setIsSaving]);

  const onSave = useCallback(
    async (input: SaveVersionInput): Promise<SaveVersionResult | undefined> => {
      if (onSaveTools !== undefined && !(await onSaveTools())) {
        return undefined;
      }

      setIsSavingLocal(true);
      setError(undefined);
      try {
        const versionOptions = getUpdateApplicationVersionQueryOptions(
          input.projectId,
          input.applicationId,
          input.versionId,
          input.version,
        );
        const versionResponse = await queryClient.fetchQuery(versionOptions);
        const versionDetail = (versionResponse as { data: ApplicationVersionDetail }).data;

        if (!needsApplicationUpdate(input)) {
          return { versionDetail };
        }

        const body: ApplicationUpdateRequest = {
          ...(input.applicationName !== undefined ? { name: input.applicationName } : {}),
          ...(input.applicationDescription !== undefined ? { description: input.applicationDescription } : {}),
          ...(input.applicationIcon !== undefined ? { icon: input.applicationIcon } : {}),
        };
        const appOptions = getEditApplicationQueryOptions(input.projectId, input.applicationId, body);
        const appResponse = await queryClient.fetchQuery(appOptions);
        const application = (appResponse as { data: ApplicationUpdatedResponse }).data;

        return { versionDetail, application };
      } catch (caught) {
        setError(caught);
        return undefined;
      } finally {
        setIsSavingLocal(false);
      }
    },
    [onSaveTools, queryClient],
  );

  return {
    onSave,
    isSaving,
    error,
    errorMessage: error === undefined ? undefined : applicationErrorMessage(error),
  };
}
