/**
 * Split out of `ChatBox.tsx` to stay under the file-length/component-props
 * budgets (§3.5) — active-participant version selection (real fetch +
 * persist) and the auto-recovery effect that selects a fallback version
 * when the participant's current version isn't in its own version list
 * (baseline: `ChatBox.jsx:2052-2063`).
 */
import { useCallback, useEffect } from 'react';

import type { Participant } from '@/entities/participant';
import { useUpdateParticipantSettingsMutation } from '@/entities/participant';
import { LATEST_VERSION_NAME } from '@/entities/version';
import type { VersionSummary } from '@/entities/version';
import { ChatParticipantType, useFetchParticipantDetails } from '@/features/chat-participants';

export interface UseChatBoxVersioningParams {
  readonly participantForEditor: Participant | undefined;
  readonly projectId: string | number | undefined;
  readonly activeConversationId: string | number | undefined;
  readonly activeParticipant: unknown;
  readonly onChangeParticipant: ((participant: unknown) => void) | undefined;
  readonly isActiveParticipantVersionMissing: boolean;
  readonly activeParticipantVersions: readonly VersionSummary[] | undefined;
}

export interface UseChatBoxVersioningResult {
  readonly handleSelectVersion: (version: VersionSummary) => Promise<void>;
}

/** Builds the `updateParticipantSettings` payload from a fetched version's details — extracted to keep `handleSelectVersion`'s complexity down. */
function buildVersionSettings(
  versionDetails: Record<string, unknown>,
  version: VersionSummary,
  participant: Participant,
): Record<string, unknown> {
  const versionMeta = versionDetails['meta'] as Record<string, unknown> | undefined;
  return {
    version_id: version.id,
    variables: versionDetails['variables'] ?? [],
    llm_settings: versionDetails['llm_settings'] ?? participant.entitySettings?.llmSettings ?? {},
    ...(versionMeta?.['icon_meta'] !== undefined ? { icon_meta: versionMeta['icon_meta'] } : {}),
  };
}

/** Merges the new version's settings into the caller's raw active-participant shape — extracted to keep `handleSelectVersion`'s complexity down. */
function mergeParticipantVersionSettings(rawActive: Record<string, unknown> | undefined, settings: Record<string, unknown>): Record<string, unknown> {
  return {
    ...rawActive,
    entity_settings: { ...(rawActive?.['entity_settings'] as Record<string, unknown> | undefined), ...settings },
  };
}

export function useChatBoxVersioning({
  participantForEditor,
  projectId,
  activeConversationId,
  activeParticipant,
  onChangeParticipant,
  isActiveParticipantVersionMissing,
  activeParticipantVersions,
}: UseChatBoxVersioningParams): UseChatBoxVersioningResult {
  const { fetchOriginalVersionDetails } = useFetchParticipantDetails();
  const { mutateAsync: updateParticipantSettingsMutateAsync } = useUpdateParticipantSettingsMutation();

  const handleSelectVersion = useCallback(
    async (version: VersionSummary) => {
      const participant = participantForEditor;
      if (!participant || projectId === undefined || activeConversationId === undefined) return;
      const chatType = participant.entityName === 'pipeline' ? ChatParticipantType.Pipelines : ChatParticipantType.Applications;
      const entityId = participant.entityMeta?.id ?? participant.id;
      const entityProjectId = participant.entityMeta?.projectId ?? String(projectId);
      const versionDetails = await fetchOriginalVersionDetails(chatType, entityId, version.id, entityProjectId, version.name);
      const settings = buildVersionSettings(versionDetails, version, participant);
      await updateParticipantSettingsMutateAsync({ projectId, conversationId: String(activeConversationId), participantId: participant.id, settings });
      onChangeParticipant?.(mergeParticipantVersionSettings(activeParticipant as Record<string, unknown> | undefined, settings));
    },
    [participantForEditor, projectId, activeConversationId, activeParticipant, onChangeParticipant, fetchOriginalVersionDetails, updateParticipantSettingsMutateAsync],
  );

  useEffect(() => {
    if (!isActiveParticipantVersionMissing) return;
    const versions = activeParticipantVersions;
    if (!versions?.length) return;
    const baseVersion = versions.find((v) => v.name === LATEST_VERSION_NAME) ?? versions[0];
    if (baseVersion) void handleSelectVersion(baseVersion);
  }, [isActiveParticipantVersionMissing, activeParticipantVersions, handleSelectVersion]);

  return { handleSelectVersion };
}
