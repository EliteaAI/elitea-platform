import { useCallback, useEffect, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { getReplaceParticipantSettingsQueryOptions } from '@/shared/api/generated/settings/settings';
import type { ParticipantSettingsRequest } from '@/shared/api/generated/model';

import { applicationErrorMessage } from '../lib/errorMessage';

/**
 * Port of
 * `apps/elitea-ui/src/hooks/application/useApplicationChatSwitchVersion.js`
 * — confirmed NOT one of the four hooks the mission brief flags as
 * "judged pure chat/RTK-Query orchestration with no real Application/
 * Toolkit domain content" (that list names `useApplicationChatSwitchVersion.js`
 * itself only as a possible dependency of OTHER sub-units, not as
 * something to skip building here — it is this sub-unit's own owned file).
 *
 * **Real endpoint, traced to Go source — wider than the generated type
 * declares.** The baseline's `useUpdateParticipantSettingsMutation` PUTs
 * `entity_settings/prompt_lib/{projectId}/{conversationId}/{participantId}`
 * with `{version_id, variables, llm_settings, icon_meta}`. The generated
 * client's same-URL operation is `useReplaceParticipantSettings`
 * (`shared/api/generated/settings/settings.ts`), whose typed body
 * (`ParticipantSettingsRequest`) only declares `llm_settings`/`version_id`.
 * Reading the real Go handler chain end to end shows the typed schema is
 * merely conservative, not the actual wire contract:
 * `UpdateEntitySettings`
 * (`services/elitea-main/internal/api/v2/conversations/handler.go:585-625`)
 * decodes the body into a plain `map[string]any` and passes it — llm_settings
 * validation/stripping aside — straight through to
 * `ConversationsRepo.UpdateEntitySettings`
 * (`internal/infra/db/repos/conversations.go:278-286`), which does
 * `json.Marshal(settings)` and `UPDATE ... SET entity_settings = $1` — a
 * REPLACE of the whole jsonb column with whatever the caller sent, no
 * per-field allowlist. `variables`/`icon_meta` therefore DO persist, exactly
 * like the baseline expects; `entitySettings` below is typed as
 * `ParticipantSettingsRequest` widened with those two extra keys (cited
 * here, not invented) rather than silently dropping fields the real backend
 * genuinely accepts.
 *
 * **Because it's a REPLACE, not a merge**, this hook — like the baseline —
 * must be called with the FULL desired `entity_settings` object each time;
 * `input.activeEntitySettings` (the participant's current settings) is
 * spread first so fields the caller doesn't override (e.g. anything else
 * stored there) survive the replace, matching the baseline's own
 * `{...activeParticipant?.entity_settings, version_id, variables,
 * llm_settings, icon_meta}` spread.
 *
 * **No toast.** `features/mcps/model/useMcpAuthModal.ts`'s own doc comment
 * already established the convention for this exact situation ("No
 * toast/snackbar primitive exists yet... surface it inline, or a real toast
 * once one exists") — `errorMessage` is returned instead of calling
 * `useToast().toastError` directly.
 */

interface ParticipantSettingsRequestWire extends ParticipantSettingsRequest {
  readonly variables?: readonly unknown[];
  readonly icon_meta?: unknown;
}

export interface ApplicationChatSwitchVersionInput {
  readonly projectId: string;
  readonly conversationId: number;
  readonly participantId: number;
  readonly activeEntitySettings: Readonly<Record<string, unknown>> | undefined;
  readonly versionId: number | string | undefined;
  readonly variables: readonly unknown[] | undefined;
  readonly llmSettings: Readonly<Record<string, unknown>> | undefined;
  readonly iconMeta: unknown;
}

export interface UseApplicationChatSwitchVersionResult {
  readonly updateParticipantWithNewVersionId: (
    input: ApplicationChatSwitchVersionInput,
  ) => Promise<Readonly<Record<string, unknown>> | undefined>;
  readonly isUpdating: boolean;
  readonly error: unknown;
  readonly errorMessage: string | undefined;
}

function buildEntitySettings(input: ApplicationChatSwitchVersionInput): Readonly<Record<string, unknown>> {
  return {
    // Spreading `undefined`/`null` into an object literal is a safe no-op
    // (no fallback needed) — only the ARRAY spread below genuinely needs
    // one, since `[...undefined]` throws.
    ...input.activeEntitySettings,
    version_id: input.versionId,
    variables: [...(input.variables ?? [])],
    llm_settings: { ...input.llmSettings },
    icon_meta: input.iconMeta ?? {},
  };
}

/**
 * Imperative half — replaces the baseline's direct
 * `updateParticipantSettings({...})` mutation call. Returns the entity
 * settings object it just sent (so the caller can, matching the baseline's
 * own `setActiveParticipant(updatedParticipant)`, merge it into its own
 * participant state) on success, `undefined` on failure (`error`/
 * `errorMessage` carry the reason).
 */
export function useApplicationChatSwitchVersion(): UseApplicationChatSwitchVersionResult {
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  const updateParticipantWithNewVersionId = useCallback(
    async (input: ApplicationChatSwitchVersionInput): Promise<Readonly<Record<string, unknown>> | undefined> => {
      setIsUpdating(true);
      setError(undefined);
      try {
        const entitySettings = buildEntitySettings(input);
        const options = getReplaceParticipantSettingsQueryOptions(
          input.projectId,
          input.conversationId,
          input.participantId,
          entitySettings as ParticipantSettingsRequestWire,
        );
        await queryClient.fetchQuery(options);
        return entitySettings;
      } catch (caught) {
        setError(caught);
        return undefined;
      } finally {
        setIsUpdating(false);
      }
    },
    [queryClient],
  );

  return {
    updateParticipantWithNewVersionId,
    isUpdating,
    error,
    errorMessage: error === undefined ? undefined : applicationErrorMessage(error),
  };
}

/**
 * Auto-triggering half — port of the baseline's own top-level
 * `useApplicationChatSwitchVersion`: watches `input.versionId`
 * (baseline: `applicationVersionDetails?.id`) and re-runs the update
 * whenever it changes to a genuinely different version (baseline:
 * `prevVersionId` state + a ref to avoid stale-closure re-runs,
 * `useApplicationChatSwitchVersion.js:57-72`).
 *
 * `onSwitched` replaces the baseline's `setActiveParticipant(updatedParticipant)`
 * call — same "caller owns its own state" redesign as `useCreateApplication.ts`.
 *
 * **`onSwitched` fires whether the PUT succeeds or fails — matching
 * `useApplicationChatSwitchVersion.js:18-43` exactly.** The baseline builds
 * `updatedParticipant` up front, awaits `updateParticipantSettings`, and
 * calls `setActiveParticipant(updatedParticipant)` UNCONDITIONALLY at line
 * 43 — a failed PUT only produces `toastError(...)` (line 40), it does not
 * skip the local-state update. So the locally-intended entity settings
 * (computed by `buildEntitySettings`, the same object the PUT attempted to
 * persist) are always handed to `onSwitched`, even on failure; `error`/
 * `errorMessage` (from the underlying `useApplicationChatSwitchVersion()`
 * call) still carry the failure for a caller that wants to surface it.
 */
export function useAutoSwitchApplicationChatVersion(
  input: ApplicationChatSwitchVersionInput,
  onSwitched: (entitySettings: Readonly<Record<string, unknown>>) => void,
): UseApplicationChatSwitchVersionResult {
  const base = useApplicationChatSwitchVersion();
  const [prevVersionId, setPrevVersionId] = useState(input.versionId);

  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const onSwitchedRef = useRef(onSwitched);
  useEffect(() => {
    onSwitchedRef.current = onSwitched;
  }, [onSwitched]);

  const updateRef = useRef(base.updateParticipantWithNewVersionId);
  useEffect(() => {
    updateRef.current = base.updateParticipantWithNewVersionId;
  }, [base.updateParticipantWithNewVersionId]);

  useEffect(() => {
    if (prevVersionId === undefined) {
      setPrevVersionId(input.versionId);
      return;
    }
    if (prevVersionId !== input.versionId) {
      // Computed up front (mirrors the baseline's `updatedParticipant`
      // being built before the PUT) so `onSwitched` gets the same object
      // regardless of whether the PUT below succeeds or fails.
      const attemptedSettings = buildEntitySettings(inputRef.current);
      void updateRef.current(inputRef.current).finally(() => {
        onSwitchedRef.current(attemptedSettings);
      });
      setPrevVersionId(input.versionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseline `useApplicationChatSwitchVersion.js:63-72` fires only on the version id/prevVersionId pair, reading the latest input/callback via refs (mirrored above) exactly like the baseline's own `updateParticipantWithNewVersionIdRef`.
  }, [input.versionId, prevVersionId]);

  return base;
}
