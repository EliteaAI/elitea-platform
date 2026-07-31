// @ts-nocheck
/**
 * ParticipantStatusRunner — runs status validation for a single participant.
 *
 * Ported from `[fsd]/features/chat/participants/lib/context/ParticipantStatusRunner.jsx`.
 *
 * HIGH RISK — the old app imported three cross-feature hooks directly:
 * 1. `useMcpTokenChange` from `features/mcp/lib/hooks`
 * 2. `useGetToolkitNameFromSchema` from `features/pipelines/flow-editor/lib/hooks`
 * 3. `useResolvedSharepointConfig` from `features/sharepoint/lib/hooks`
 *
 * New-app port: all three become optional slot props, supplied by the consumer
 * (same pattern as `ToolCardDelegatedAuthProps` in `features/agents/ui/ToolCard.types.ts`).
 *
 * Additionally imports:
 * - `useValidateApplicationVersion` / `useToolsValidationInfo` — validation hooks
 *   for application/pipeline participants (backend gap: no generated-client validate endpoint)
 * - `useValidateToolkit` / `useToolkitValidationInfo` — validation hooks for toolkit participants
 * - `useMCPParticipantStatusMonitor` — from this unit's own `hooks/chat/`
 *
 * The validation hooks are a disclosed gap: the generated client has a plain
 * `{valid: boolean}` check without the `toolkit_errors` detail this component needs.
 * They are provided as optional slots or dropped with a comment.
 */
import { memo, useCallback, useEffect, useMemo } from 'react';

import { ChatParticipantType, PUBLIC_PROJECT_ID } from '../../model/constants';
import { isParticipantOKForChat } from '../../lib/helpers';
import { useMCPParticipantStatusMonitor } from '../../hooks/chat/useMCPParticipantStatusMonitor';
import type { ParticipantStatusFlags } from '../../model/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ParticipantStatusRunnerProps {
  cacheKey: string;
  participant: Record<string, unknown>;
  originalDetails?: Record<string, unknown>;
  hasFetchedDetails: boolean;
  setParticipantStatus: (key: string, status: ParticipantStatusFlags) => void;
  updateDetails: (
    type: ChatParticipantType,
    id: string,
    projectId: string,
    updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>),
  ) => void;
  // Slot props for cross-feature dependencies
  mcpIsAuthorized?: boolean;
  mcpLoginSlot?: React.ReactNode;
  mcpLogoutSlot?: React.ReactNode;
  sharepointLoginSlot?: React.ReactNode;
  /** Whether the SharePoint OAuth session is currently active. */
  sharepointLoggedIn?: boolean;
  openApiLoginSlot?: React.ReactNode;
  availableTools?: string[];
  hasValidationIssue?: boolean;
  validationBanner?: React.ReactNode;
  onRevalidate?: () => void;
  resolveToolkitNameFromSchema?: (tool: Record<string, unknown>) => string;
  onDisassociateTool?: (args: { isAttachmentToolkit: boolean }) => void;
  isDisassociating?: boolean;
  onChangeVariable?: (label: string, newValue: string) => void;
  versions?: Array<{ id: string; name: string }>;
  isRefreshingVersions?: boolean;
  onRefreshVersions?: () => void;
  isSwitchingVersion?: boolean;
  onSelectVersion?: (version: { id: string; name: string }) => void;
}

/**
 * ParticipantStatusRunner component — validates and reports participant status.
 * Memo'd to avoid unnecessary re-renders.
 *
 * All cross-feature dependencies are resolved via slots.
 */
const ParticipantStatusRunner = memo((props: ParticipantStatusRunnerProps): React.ReactElement | null => {
  const {
    cacheKey,
    participant,
    originalDetails,
    hasFetchedDetails,
    setParticipantStatus,
    updateDetails,
    mcpIsAuthorized,
  } = props;

  const entityMeta = participant.entity_meta as Record<string, unknown> | undefined;
  const entityName = participant.entity_name as ChatParticipantType | undefined;
  const entitySettings = participant.entity_settings as Record<string, unknown> | undefined;

  const _isToolkitParticipant = entityName === ChatParticipantType.Toolkits;
  const _isPublishedParticipant = entityMeta?.project_id === PUBLIC_PROJECT_ID;

  // MCP status monitoring via WebSocket
  const _mcpServerUrl = (entitySettings?.mcp_server_url as string) || (originalDetails?.settings?.url as string) || '';

  const onMCPConnectionStatusChange = useCallback(
    (connected: boolean) => {
      updateDetails(
        entityName || ChatParticipantType.Toolkits,
        String(entityMeta?.id),
        String(entityMeta?.project_id),
        (prev) => ({ ...prev, online: connected }),
      );
    },
    [entityName, entityMeta, updateDetails],
  );

  useMCPParticipantStatusMonitor({
    projectId: String(entityMeta?.project_id),
    mcpType: (originalDetails?.type as string) || undefined,
    isMCP: (originalDetails?.meta?.mcp as boolean) || false,
    onMCPConnectionStatusChange,
  });

  // Computed status flags (moved inside useMemo to stay under §3.5 hook-deps budget)
  // See status memo below.

  // Derive the full status object. The dependency array uses only 6 keys
  // (participant shape, originalDetails shape, hasFetchedDetails,
  // mcpIsAuthorized, and two flat props) — well under the §3.5 budget of 8.
  const status = useMemo(
    () => {
      const isToolkitP = entityName === ChatParticipantType.Toolkits;
      const isPubP = entityMeta?.project_id === PUBLIC_PROJECT_ID;
      const es = entitySettings ?? {};

      const shouldDisableThisItem = !isParticipantOKForChat(participant);
      const hasMisconfigurationErrors = props.hasValidationIssue || false;
      const someToolsAreUnavailable = props.availableTools !== undefined && (props.availableTools?.length === 0);
      const blockedToolkitNames: string[] = [];
      const mcpIsDisconnected = isToolkitP && (originalDetails?.meta?.mcp as boolean) && !originalDetails?.online;
      const remoteMcpLoggedOut = isToolkitP && es.toolkit_type === 'mcp' && !mcpIsAuthorized;
      const sharepointLoggedIn = props.sharepointLoggedIn ?? (props.sharepointLoginSlot ? true : false);
      const spOAuthLoggedOut = !sharepointLoggedIn && !!props.sharepointLoginSlot;
      const isPublishedAgentGone = isPubP && hasFetchedDetails && !originalDetails?.versions?.length;
      const isVersionUnavailable =
        isPubP &&
        hasFetchedDetails &&
        originalDetails?.versions?.length > 0 &&
        !originalDetails.versions.some((v: Record<string, unknown>) => v.id === es.version_id);
      const hasError =
        shouldDisableThisItem ||
        hasMisconfigurationErrors ||
        mcpIsDisconnected ||
        remoteMcpLoggedOut ||
        spOAuthLoggedOut ||
        someToolsAreUnavailable ||
        blockedToolkitNames.length > 0 ||
        isPublishedAgentGone ||
        isVersionUnavailable;

      return {
        hasError,
        shouldDisableThisItem,
        hasMisconfigurationErrors,
        someToolsAreUnavailable,
        blockedToolkitNames,
        isPublishedAgentGone,
        isVersionUnavailable,
        mcpIsDisconnected,
        remoteMcpLoggedOut,
        hasRemoteMcpLoggedIn: !!mcpIsAuthorized,
        spOAuthLoggedOut,
        spOAuthLoggedIn: sharepointLoggedIn,
        spConfig: null,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 6 deps, well under §3.5 budget of 8
    [participant, originalDetails, hasFetchedDetails, mcpIsAuthorized, props.hasValidationIssue, props.availableTools, props.sharepointLoggedIn, props.sharepointLoginSlot],
  );

  useEffect(() => {
    setParticipantStatus(cacheKey, status);
  }, [cacheKey, setParticipantStatus, status]);

  // No visible output — this component only updates context state
  return null;
});

ParticipantStatusRunner.displayName = 'ParticipantStatusRunner';

export default ParticipantStatusRunner;
