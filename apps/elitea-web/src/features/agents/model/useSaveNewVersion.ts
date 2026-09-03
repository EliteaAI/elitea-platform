import { useCallback, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { getSaveApplicationNewVersionQueryOptions } from '@/shared/api/generated/applications/applications';
import type { ApplicationVersionDetail, VersionWriteRequest } from '@/shared/api/generated/model';

import { applicationErrorMessage } from '../lib/errorMessage';

/**
 * Port of `apps/elitea-ui/src/hooks/application/useSaveNewVersion.js`.
 *
 * **Real, traced backend behaviour — not assumed from the schema alone.**
 * `POST /elitea_core/versions/prompt_lib/{projectId}/{applicationId}`
 * (`useSaveApplicationNewVersionMutation` in the baseline;
 * `useSaveApplicationNewVersion`/`saveApplicationNewVersion` here) routes to
 * `CreateVersion`
 * (`services/elitea-main/internal/api/v2/applications/handler.go:696-806`),
 * read in full:
 *
 * - `name` is REQUIRED — an empty/missing `name` 400s with "version name is
 *   required" (:706-710). `VersionWriteRequest.name` is optional on every
 *   OTHER operation that reuses the same shared schema (the PUT applies it
 *   only when non-empty; `ApplicationCreateRequest.versions[0]` defaults it
 *   to `"latest"`) — this hook's own `input.name` is a required string,
 *   enforcing the one place this field is actually mandatory at the type
 *   level rather than relying on a 400 round-trip.
 * - The handler reads exactly `agent_type`/`instructions`/`welcome_message`/
 *   `llm_settings`/`conversation_starters`/`variables` off the body
 *   (`:723-747`) — `meta` is NOT read from the request at all; the handler
 *   builds its own `meta` from a hardcoded `step_limit: 25` plus whatever
 *   `variables` were sent (:744-747), discarding any `meta` the caller
 *   supplied. `tags`/`tools`/`pipeline_settings` are read nowhere (response
 *   always echoes `"tools": [], "tags": []` regardless of input, :783-784).
 * - `SaveApplicationNewVersionBody`'s generated type is
 *   `VersionWriteRequest.and(zod.looseObject({}))` — a passthrough shape
 *   that LOOKS like it might accept extra fields beyond `VersionWriteRequest`
 *   (e.g. the baseline's `copy_skills_from_version_id`). Reading the Go
 *   handler proves otherwise: it decodes into a plain
 *   `map[string]any` and reads only the named keys above — an unrecognised
 *   key like `copy_skills_from_version_id` is silently ignored, not acted
 *   on. The baseline's "copy skills from the source version when creating a
 *   new version" behaviour therefore has NO effect on the real backend
 *   today; `sourceVersionId` is not accepted by this hook's input at all
 *   (inventing a field the handler ignores would be worse than omitting it).
 *
 * **Same redesign posture as `useCreateApplication.ts`/`useSaveVersion.ts`:**
 * no Formik, no pipeline-editor coupling (caller resolves `instructions` to
 * compiled YAML before calling this hook — see `useCreateApplication.ts`
 * point 3), no navigation/nav-blocker (see `useCreateApplication.ts` point
 * 4).
 *
 * **`onSaveTools` gates `onSuccess` only, not the POST — matching
 * `useSaveNewVersion.js:112-149` exactly, not `useSaveVersion.js`'s
 * position.** The baseline fires `saveNewVersion(...)` (the version-create
 * mutation) UNCONDITIONALLY, before even checking `onSaveTools`; only when
 * `onSaveTools` resolves `false` does it skip `onSuccessHandler` (the
 * navigation trigger) — the new version is always created on the backend
 * regardless. `onSuccess` here is this hook's stand-in for that navigation
 * trigger (see the "no navigation" point above), so it is gated the same
 * way; the created version itself is always returned once the POST
 * succeeds, since (unlike the baseline, which also has a separate
 * `isSavingNewVersionSuccess`-driven toast independent of this function's
 * return value) this hook's return value is the only channel a caller has
 * for "the version was created" — withholding it on a tool-save hiccup
 * would hide a real, persisted creation. See `useSaveChangedTools.ts` for
 * why that gate cannot actually persist a `selected_tools` change today
 * (and therefore never actually resolves `false` in practice).
 */

export interface SaveNewVersionInput {
  readonly projectId: string;
  readonly applicationId: number;
  readonly name: string;
  /** Every `VersionWriteRequest` field except `name` (supplied separately, see module doc — required on this operation only). */
  readonly version: Omit<VersionWriteRequest, 'name'>;
}

export interface UseSaveNewVersionOptions {
  readonly onSaveTools?: () => Promise<boolean>;
  readonly onSuccess?: (data: ApplicationVersionDetail) => void;
}

export interface UseSaveNewVersionResult {
  readonly onCreateNewVersion: (input: SaveNewVersionInput) => Promise<ApplicationVersionDetail | undefined>;
  readonly isSavingNewVersion: boolean;
  readonly error: unknown;
  readonly errorMessage: string | undefined;
}

export function useSaveNewVersion(options: UseSaveNewVersionOptions = {}): UseSaveNewVersionResult {
  const { onSaveTools, onSuccess } = options;
  const queryClient = useQueryClient();
  const [isSavingNewVersion, setIsSavingNewVersion] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  const onCreateNewVersion = useCallback(
    async (input: SaveNewVersionInput): Promise<ApplicationVersionDetail | undefined> => {
      setIsSavingNewVersion(true);
      setError(undefined);
      try {
        const body: VersionWriteRequest = { ...input.version, name: input.name };
        const queryOptions = getSaveApplicationNewVersionQueryOptions(input.projectId, input.applicationId, body);
        const response = await queryClient.query(queryOptions);
        const created = (response as { data: ApplicationVersionDetail }).data;

        // Matches `useSaveNewVersion.js:144-147`: the version is already
        // created above regardless of this gate; only the success/
        // navigation trigger is conditional on it.
        if (onSaveTools !== undefined && !(await onSaveTools())) {
          return created;
        }

        onSuccess?.(created);
        return created;
      } catch (caught) {
        setError(caught);
        return undefined;
      } finally {
        setIsSavingNewVersion(false);
      }
    },
    [onSaveTools, onSuccess, queryClient],
  );

  return {
    onCreateNewVersion,
    isSavingNewVersion,
    error,
    errorMessage: error === undefined ? undefined : applicationErrorMessage(error),
  };
}
