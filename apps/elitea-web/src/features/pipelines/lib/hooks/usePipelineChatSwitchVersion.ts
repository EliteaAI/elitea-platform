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
 */
export function useAutoSwitchPipelineChatVersion(
  input: PipelineChatSwitchVersionInput,
  onSwitched: (entitySettings: Readonly<Record<string, unknown>>) => void,
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
      void updateRef.current(inputRef.current).then((entitySettings) => {
        if (entitySettings !== undefined) onSwitchedRef.current(entitySettings);
      });
      setPrevVersionId(input.versionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseline `useApplicationChatSwitchVersion.js:63-72` fires only on the version id/prevVersionId pair, reading the latest input/callback via refs (mirrored above).
  }, [input.versionId, prevVersionId]);

  return base;
}
