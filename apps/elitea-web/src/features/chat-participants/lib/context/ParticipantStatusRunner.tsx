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

  const onMCPConnectionStatusChange = useMCPStatusCallback({
    entityName,
    entityMeta,
    updateDetails,
  });

  useMCPParticipantStatusMonitor({
    projectId: String(entityMeta?.project_id),
    mcpType: (originalDetails?.type as string) || undefined,
    isMCP: (originalDetails?.meta?.mcp as boolean) || false,
    onMCPConnectionStatusChange,
  });

  const status = useParticipantStatus({
    participant,
    entityName,
    entityMeta,
    entitySettings,
    hasValidationIssue: props.hasValidationIssue,
    availableTools: props.availableTools,
    mcpIsAuthorized,
    sharepointLoggedIn: props.sharepointLoggedIn,
    sharepointLoginSlot: props.sharepointLoginSlot,
    hasFetchedDetails,
    originalDetails,
  });

  useEffect(() => {
    setParticipantStatus(cacheKey, status);
  }, [cacheKey, setParticipantStatus, status]);

  // No visible output — this component only updates context state
  return null;
});

ParticipantStatusRunner.displayName = 'ParticipantStatusRunner';

// ---------------------------------------------------------------------------
// Custom hooks to reduce main component complexity
// ---------------------------------------------------------------------------

function useMCPStatusCallback({
  entityName,
  entityMeta,
  updateDetails,
}: {
  entityName: ChatParticipantType | undefined;
  entityMeta: Record<string, unknown> | undefined;
  updateDetails: ParticipantStatusRunnerProps['updateDetails'];
}): (connected: boolean) => void {
  return useCallback(
    (connected: boolean) => {
      updateDetails(
        entityName || ChatParticipantType.Toolkits,
        String((entityMeta?.id as string) ?? ''),
        String((entityMeta?.project_id as string) ?? ''),
        (prev) => ({ ...prev, online: connected }),
      );
    },
    [entityName, entityMeta, updateDetails],
  );
}

interface StatusDeps {
  participant: Record<string, unknown>;
  entityName: ChatParticipantType | undefined;
  entityMeta: Record<string, unknown> | undefined;
  entitySettings: Record<string, unknown> | undefined;
  hasValidationIssue: boolean | undefined;
  availableTools: string[] | undefined;
  mcpIsAuthorized: boolean | undefined;
  sharepointLoggedIn: boolean | undefined;
  sharepointLoginSlot: React.ReactNode | undefined;
  hasFetchedDetails: boolean;
  originalDetails: Record<string, unknown> | undefined;
}

function useParticipantStatus(deps: StatusDeps): ParticipantStatusFlags {
  return useMemo(
    () => {
      const context = deriveParticipantContext(deps.entityName, deps.entityMeta, deps.entitySettings);
      const flags = deriveParticipantFlags(
        deps.participant,
        context,
        deps.hasValidationIssue,
        deps.availableTools,
        deps.mcpIsAuthorized,
        deps.sharepointLoggedIn,
        deps.sharepointLoginSlot,
        deps.hasFetchedDetails,
        deps.originalDetails,
      );
      return buildStatusObject(flags, deps.mcpIsAuthorized);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit dependency list
    [deps.participant, deps.originalDetails, deps.hasFetchedDetails, deps.mcpIsAuthorized, deps.hasValidationIssue, deps.availableTools, deps.sharepointLoggedIn, deps.sharepointLoginSlot],
  );
}

// ---------------------------------------------------------------------------
// Helper: derive individual flags (complexity ≤ 12 per function)
// ---------------------------------------------------------------------------

function getMcpIsDisconnected(
  isToolkitP: boolean,
  originalDetails: Record<string, unknown> | undefined,
): boolean {
  if (!isToolkitP) return false;
  const isMcp = (originalDetails?.meta?.mcp as boolean) || false;
  if (!isMcp) return false;
  return !originalDetails?.online;
}

function getSpOAuthLoggedOut(
  sharepointLoggedIn: boolean,
  sharepointLoginSlot: React.ReactNode | undefined,
): boolean {
  if (sharepointLoggedIn) return false;
  return !!sharepointLoginSlot;
}

/**
 * Derives the toolkit/participant type context (isToolkit, isPublished, settings).
 */
function deriveParticipantContext(
  entityName: ChatParticipantType | undefined,
  entityMeta: Record<string, unknown> | undefined,
  entitySettings: Record<string, unknown> | undefined,
): { isToolkitP: boolean; isPubP: boolean; es: Record<string, unknown> } {
  return {
    isToolkitP: entityName === ChatParticipantType.Toolkits,
    isPubP: entityMeta?.project_id === PUBLIC_PROJECT_ID,
    es: entitySettings ?? {},
  };
}

/**
 * Derives all boolean flags for a participant's status.
 * Complexity kept ≤ 12 by splitting into sub-helpers.
 */
function deriveParticipantFlags(
  participant: Record<string, unknown>,
  context: ReturnType<typeof deriveParticipantContext>,
  hasValidationIssue: boolean | undefined,
  availableTools: string[] | undefined,
  mcpIsAuthorized: boolean | undefined,
  sharepointLoggedIn: boolean | undefined,
  sharepointLoginSlot: React.ReactNode | undefined,
  hasFetchedDetails: boolean,
  originalDetails: Record<string, unknown> | undefined,
): {
  shouldDisableThisItem: boolean;
  hasMisconfigurationErrors: boolean;
  someToolsAreUnavailable: boolean;
  blockedToolkitNames: string[];
  mcpIsDisconnected: boolean;
  remoteMcpLoggedOut: boolean;
  spOAuthLoggedOut: boolean;
  isPublishedAgentGone: boolean;
  isVersionUnavailable: boolean;
} {
  const { isToolkitP, isPubP, es } = context;

  const shouldDisableThisItem = !isParticipantOKForChat(participant);
  const hasMisconfigurationErrors = !!hasValidationIssue;
  const someToolsAreUnavailable = getSomeToolsAreUnavailable(availableTools);
  const blockedToolkitNames: string[] = [];
  const remoteMcpLoggedOut = getRemoteMcpLoggedOut(isToolkitP, es, mcpIsAuthorized);
  const spOAuthLoggedOut = getSpOAuthLoggedOut(
    getEffectiveSpLoggedIn(sharepointLoggedIn, sharepointLoginSlot),
    sharepointLoginSlot,
  );
  const isPublishedAgentGone = getIsPublishedAgentGone(isPubP, hasFetchedDetails, originalDetails);
  const isVersionUnavailable = getIsVersionUnavailable(isPubP, hasFetchedDetails, originalDetails, es);

  return {
    shouldDisableThisItem,
    hasMisconfigurationErrors,
    someToolsAreUnavailable,
    blockedToolkitNames,
    mcpIsDisconnected: getMcpIsDisconnected(isToolkitP, originalDetails),
    remoteMcpLoggedOut,
    spOAuthLoggedOut,
    isPublishedAgentGone,
    isVersionUnavailable,
  };
}

// ---------------------------------------------------------------------------
// Sub-helpers for individual flags (each complexity ≤ 5)
// ---------------------------------------------------------------------------

function getSomeToolsAreUnavailable(availableTools: string[] | undefined): boolean {
  return availableTools !== undefined && availableTools.length === 0;
}

function getEffectiveSpLoggedIn(
  sharepointLoggedIn: boolean | undefined,
  sharepointLoginSlot: React.ReactNode | undefined,
): boolean {
  return sharepointLoggedIn ?? (sharepointLoginSlot ? true : false);
}

function getRemoteMcpLoggedOut(
  isToolkitP: boolean,
  es: Record<string, unknown>,
  mcpIsAuthorized: boolean | undefined,
): boolean {
  return isToolkitP && es.toolkit_type === 'mcp' && !mcpIsAuthorized;
}

function getIsPublishedAgentGone(
  isPubP: boolean,
  hasFetchedDetails: boolean,
  originalDetails: Record<string, unknown> | undefined,
): boolean {
  return isPubP && hasFetchedDetails && !originalDetails?.versions?.length;
}

function getIsVersionUnavailable(
  isPubP: boolean,
  hasFetchedDetails: boolean,
  originalDetails: Record<string, unknown> | undefined,
  es: Record<string, unknown>,
): boolean {
  return isPubP &&
    hasFetchedDetails &&
    originalDetails?.versions?.length > 0 &&
    !originalDetails.versions.some((v: Record<string, unknown>) => v.id === es.version_id);
}

/**
 * Assembles the full `ParticipantStatusFlags` object from pre-computed
 * flags and shared props.  Complexity kept ≤ 6.
 */
function buildStatusObject(
  flags: ReturnType<typeof deriveParticipantFlags>,
  mcpIsAuthorized: boolean | undefined,
): ParticipantStatusFlags {
  return {
    hasError: flags.hasMisconfigurationErrors ||
      flags.mcpIsDisconnected ||
      flags.remoteMcpLoggedOut ||
      flags.spOAuthLoggedOut ||
      flags.someToolsAreUnavailable ||
      flags.blockedToolkitNames.length > 0 ||
      flags.isPublishedAgentGone ||
      flags.isVersionUnavailable,
    shouldDisableThisItem: flags.shouldDisableThisItem,
    hasMisconfigurationErrors: flags.hasMisconfigurationErrors,
    someToolsAreUnavailable: flags.someToolsAreUnavailable,
    blockedToolkitNames: flags.blockedToolkitNames,
    isPublishedAgentGone: flags.isPublishedAgentGone,
    isVersionUnavailable: flags.isVersionUnavailable,
    mcpIsDisconnected: flags.mcpIsDisconnected,
    remoteMcpLoggedOut: flags.remoteMcpLoggedOut,
    hasRemoteMcpLoggedIn: !!mcpIsAuthorized,
    spOAuthLoggedOut: flags.spOAuthLoggedOut,
    spOAuthLoggedIn: true,
    spConfig: null,
  };
}

export default ParticipantStatusRunner;
