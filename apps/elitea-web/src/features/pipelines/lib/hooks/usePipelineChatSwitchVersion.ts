/**
 * Local duplicate of `apps/elitea-ui/src/hooks/application/
 * useApplicationChatSwitchVersion.js`, scoped to `features/pipelines` — per
 * this mission's own explicit instruction: "`useApplicationChatSwitchVersion`
 * is also NOT promoted (same list) -- duplicate here too." (the four-hooks
 * list judges it "pure chat/RTK-Query orchestration with no real
 * Application/Toolkit domain content"). `features/agents/model/
 * useApplicationChatSwitchVersion.ts` (Wave-2 unit A1e) already ported this
 * exact baseline file faithfully; this file reproduces that same port (not
 * a re-derivation), renamed to avoid an "Application"-only name on a
 * pipelines-owned file, and NOT imported from `features/agents`
 * (`no-sideways-features` forbids it).
 *
 * See that file's own doc comment for the full evidence trail this port
 * carries forward unchanged:
 *  - Real endpoint, traced to Go source: baseline's `useUpdateParticipantSettingsMutation`
 *    -> generated `useReplaceParticipantSettings`
 *    (`shared/api/generated/settings/settings.ts`) PUTs
 *    `entity_settings/prompt_lib/{projectId}/{conversationId}/{participantId}`;
 *    the Go handler chain (`internal/api/v2/conversations/handler.go:585-625`
 *    -> `internal/infra/db/repos/conversations.go:278-286`) does a whole-jsonb
 *    REPLACE via `json.Marshal(settings)`, so `variables`/`icon_meta` (not in
 *    the generated `ParticipantSettingsRequest` type) DO persist — the wire
 *    type below is widened accordingly, not silently narrowed.
 *  - No toast: `errorMessage` is returned instead of calling a toast
 *    primitive that does not exist yet in this app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { t } from '@/shared/i18n';
import { getReplaceParticipantSettingsQueryOptions } from '@/shared/api/generated/settings/settings';
import type { ParticipantSettingsRequest } from '@/shared/api/generated/model';

import { pipelineErrorMessage } from './pipelineErrorMessage';

interface ParticipantSettingsRequestWire extends ParticipantSettingsRequest {
  readonly variables?: readonly unknown[];
  readonly icon_meta?: unknown;
}

export interface PipelineChatSwitchVersionInput {
  readonly projectId: string;
  readonly conversationId: number;
  readonly participantId: number;
  readonly activeEntitySettings: Readonly<Record<string, unknown>> | undefined;
  readonly versionId: number | string | undefined;
  readonly variables: readonly unknown[] | undefined;
  readonly llmSettings: Readonly<Record<string, unknown>> | undefined;
  readonly iconMeta: unknown;
}

export interface UsePipelineChatSwitchVersionResult {
  readonly updateParticipantWithNewVersionId: (
    input: PipelineChatSwitchVersionInput,
  ) => Promise<Readonly<Record<string, unknown>> | undefined>;
  readonly isUpdating: boolean;
  readonly error: unknown;
  readonly errorMessage: string | undefined;
}

function buildEntitySettings(input: PipelineChatSwitchVersionInput): Readonly<Record<string, unknown>> {
  return {
    ...input.activeEntitySettings,
    version_id: input.versionId,
    variables: [...(input.variables ?? [])],
    llm_settings: { ...input.llmSettings },
    icon_meta: input.iconMeta ?? {},
  };
}

/** Imperative half — the caller decides when to fire it and how to merge the returned entity settings into its own participant state. */
export function usePipelineChatSwitchVersion(): UsePipelineChatSwitchVersionResult {
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  const updateParticipantWithNewVersionId = useCallback(
    async (input: PipelineChatSwitchVersionInput): Promise<Readonly<Record<string, unknown>> | undefined> => {
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
    errorMessage: error === undefined ? undefined : pipelineErrorMessage(error),
  };
}

/**
 * Auto-triggering half — watches `input.versionId` and re-runs the update
 * whenever it changes to a genuinely different version (baseline:
 * `prevVersionId` state + a ref to avoid stale-closure re-runs,
 * `useApplicationChatSwitchVersion.js:57-72`).
 *
 * **Bugfix against a naive port (2 defects, both traced to the same root cause):** the original
 * port only called `onSwitchedRef.current(entitySettings)` when the PUT succeeded
 * (`entitySettings !== undefined`), and never reported a failure anywhere. Baseline
 * `useApplicationChatSwitchVersion.js:18-43` does neither of those things:
 *  1. It builds `updatedParticipant` BEFORE the PUT and calls
 *     `setActiveParticipant(updatedParticipant)` UNCONDITIONALLY at line 43 — a failed PUT only
 *     produces `toastError(...)` (line 40); it never skips the local participant-state update. A
 *     silent-on-failure `onSwitched` therefore left the active participant's `entitySettings`
 *     (`llm_settings`/`variables`/`version_id`/`icon_meta`) stuck on the OLD version after a failed
 *     switch, permanently out of sync with `pipelineVersionDetails` (which the caller has already
 *     moved on from). Fixed by computing `attemptedSettings` up front (this file's own
 *     `buildEntitySettings`, the exact object the PUT attempts to persist) and always handing it to
 *     `onSwitchedRef.current`, success or failure — this now matches `features/agents/model/
 *     useApplicationChatSwitchVersion.ts`'s own identical fix for the sibling baseline hook
 *     (`useAutoSwitchApplicationChatVersion`), which this file otherwise mirrors line for line.
 *  2. Baseline's `toastError(buildErrorMessage(result.error))` (line 40) is real user-visible
 *     feedback on failure. This port has no toast primitive (this file's own module doc comment),
 *     so an optional `onError` callback — the same `(message: string) => void` convention already
 *     used by `onInfo`/`onError` throughout `usePipelineChat.hooks.ts` and its sibling sub-hooks —
 *     is fired instead when the PUT fails, so a caller CAN surface it once a toast/snackbar exists.
 *     `base.error`/`base.errorMessage` remain available too for a caller that wants the raw value.
 *
 * **Bugfix (3) — spurious "switch to undefined" caused by bugfix (1) firing unconditionally.**
 * `pipelineChat.helpers.ts`'s `switchVersionId` (this hook's only real caller, via
 * `usePipelineChat.hooks.ts`) drops back to `undefined` whenever `conversationReady` goes false —
 * which happens on the SAME render commit a real version switch lands, because
 * `usePipelineChatConversation.hooks.ts`'s chat-history-reset effect (also keyed on
 * `pipelineVersionDetails?.id`) clears `activeConversation.id`/`uuid` as part of starting a fresh
 * conversation for the new version. Before bugfix (1), this second "switch to `undefined`" firing
 * was harmless: its PUT (built from a stale/garbage `conversationId: 0`) predictably failed, and a
 * failed PUT never called `onSwitched`. Bugfix (1) made `onSwitched` unconditional, so this
 * previously-harmless second firing would DETERMINISTICALLY overwrite the just-applied, correct
 * `entitySettings.version_id` back to `undefined` on every normal version switch made while
 * chatting with existing history — worse than the original bug (1) was fixing, not just a residual
 * risk. Fixed by treating a transition TO `input.versionId === undefined` identically to the
 * existing initial-mount `prevVersionId === undefined` guard above: track it, but don't fire the
 * PUT/`onSwitched`/`onError` at all. This also means once the reset conversation settles and
 * `switchVersionId` recomputes the REAL version id again, `prevVersionId` is `undefined` at that
 * point, so it lands back in the `prevVersionId === undefined` branch too — "undefined means not
 * ready yet" stays a single, consistent contract throughout this hook, and the "first version is
 * never mistaken for a switch" guarantee this whole gate exists for is preserved.
 */
export function useAutoSwitchPipelineChatVersion(
  input: PipelineChatSwitchVersionInput,
  onSwitched: (entitySettings: Readonly<Record<string, unknown>>) => void,
  onError?: (message: string) => void,
): UsePipelineChatSwitchVersionResult {
  const base = usePipelineChatSwitchVersion();
  const [prevVersionId, setPrevVersionId] = useState(input.versionId);

  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const onSwitchedRef = useRef(onSwitched);
  useEffect(() => {
    onSwitchedRef.current = onSwitched;
  }, [onSwitched]);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

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
      if (input.versionId === undefined) {
        // Not a real switch -- see this function's own doc comment, bugfix (3).
        setPrevVersionId(input.versionId);
        return;
      }
      // Computed up front so `onSwitched` receives the same object regardless of whether the PUT
      // below succeeds or fails — see this function's own doc comment, bugfix (1).
      const attemptedSettings = buildEntitySettings(inputRef.current);
      void updateRef.current(inputRef.current).then((entitySettings) => {
        onSwitchedRef.current(attemptedSettings);
        if (entitySettings === undefined) {
          onErrorRef.current?.(t('pipelines.chat.switchVersionFailed', 'Failed to switch pipeline version'));
        }
      });
      setPrevVersionId(input.versionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseline `useApplicationChatSwitchVersion.js:63-72` fires only on the version id/prevVersionId pair, reading the latest input/callback via refs (mirrored above).
  }, [input.versionId, prevVersionId]);

  return base;
}
