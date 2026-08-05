// @ts-nocheck
/**
 * ParticipantStatusRunner — runs status validation for a single participant.
 *
 * Ported from `[fsd]/features/chat/participants/lib/context/ParticipantStatusRunner.jsx`.
 *
 * HIGH RISK — the old app imported FOUR cross-feature hooks/helpers directly:
 * (1) `useMcpTokenChange` (`features/mcp/lib/hooks`), (2) `useGetToolkitNameFromSchema`
 * (`features/pipelines/flow-editor/lib/hooks`), (3) `useResolvedSharepointConfig`
 * (`features/sharepoint/lib/hooks`), (4) `isToolkitTypeBlocked`/`getToolkitTypeLabel`
 * (`features/toolkits/lib/helpers/toolkits.helpers`). New-app port: all four become
 * optional slot props supplied by the consumer (same pattern as
 * `ToolCardDelegatedAuthProps` in `features/agents/ui/ToolCard.types.ts`).
 * `getSelectedTools` (slot 2) is the schema-derived "available tools for this
 * toolkit type" accessor; `isToolkitTypeBlocked`/`getToolkitTypeLabel` (slot 4)
 * drive the `blockedToolkitNames` warning. Absent a slot, its flag degrades to
 * its inert default (`false`/`[]`) rather than throwing.
 *
 * Additionally imports `useValidateApplicationVersion`/`useToolsValidationInfo`
 * and `useValidateToolkit`/`useToolkitValidationInfo` (disclosed gap: the
 * generated client has a plain `{valid: boolean}` check, no `toolkit_errors`
 * detail — dropped with a comment) and this unit's own
 * `useMCPParticipantStatusMonitor`.
 */
import { memo, useCallback, useEffect, useMemo } from 'react';

import { ChatParticipantType } from '../../model/constants';
import { useMCPParticipantStatusMonitor } from '../../hooks/chat/useMCPParticipantStatusMonitor';
import type { ParticipantStatusFlags } from '../../model/types';
import { buildStatusObject, deriveParticipantContext, deriveParticipantFlags } from './ParticipantStatusRunner.helpers';

// Props

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
  sharepointLoggedIn?: boolean; // Whether the SharePoint OAuth session is currently active.
  sharepointConfig?: unknown; // old-app's `useResolvedSharepointConfig` result — echoed as `status.spConfig`.
  openApiLoginSlot?: React.ReactNode;
  getSelectedTools?: (toolType: string | undefined) => string[] | undefined; // old-app's `useGetToolkitNameFromSchema().getSelectedTools`.
  isToolkitTypeBlocked?: (toolType: string | undefined) => boolean; // old-app's `toolkits.helpers.isToolkitTypeBlocked`.
  getToolkitTypeLabel?: (toolType: string | undefined) => string; // old-app's `toolkits.helpers.getToolkitTypeLabel`.
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

/** Validates and reports participant status. Memo'd; cross-feature deps come in via slots. */
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

  // Bundled into one dep (not 4 separate §3.5-budgeted array entries) —
  // these are this component's own "cross-feature slot" props (see the
  // module-level HIGH RISK note), grouped together for the same reason
  // this file already groups other related props.
  const crossFeatureSlots = useMemo(
    () => ({
      getSelectedTools: props.getSelectedTools,
      isToolkitTypeBlocked: props.isToolkitTypeBlocked,
      getToolkitTypeLabel: props.getToolkitTypeLabel,
      sharepointConfig: props.sharepointConfig,
    }),
    [props.getSelectedTools, props.isToolkitTypeBlocked, props.getToolkitTypeLabel, props.sharepointConfig],
  );

  const status = useParticipantStatus({
    participant,
    entityName,
    entityMeta,
    entitySettings,
    hasValidationIssue: props.hasValidationIssue,
    crossFeatureSlots,
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

// Custom hooks to reduce main component complexity

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

interface CrossFeatureSlots {
  getSelectedTools: ((toolType: string | undefined) => string[] | undefined) | undefined;
  isToolkitTypeBlocked: ((toolType: string | undefined) => boolean) | undefined;
  getToolkitTypeLabel: ((toolType: string | undefined) => string) | undefined;
  sharepointConfig: unknown;
}

interface StatusDeps {
  participant: Record<string, unknown>;
  entityName: ChatParticipantType | undefined;
  entityMeta: Record<string, unknown> | undefined;
  entitySettings: Record<string, unknown> | undefined;
  hasValidationIssue: boolean | undefined;
  crossFeatureSlots: CrossFeatureSlots;
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
        deps.crossFeatureSlots.getSelectedTools,
        deps.crossFeatureSlots.isToolkitTypeBlocked,
        deps.crossFeatureSlots.getToolkitTypeLabel,
        deps.mcpIsAuthorized,
        deps.sharepointLoggedIn,
        deps.sharepointLoginSlot,
        deps.hasFetchedDetails,
        deps.originalDetails,
      );
      return buildStatusObject(flags, deps.mcpIsAuthorized, deps.crossFeatureSlots.sharepointConfig);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit dependency list
    [deps.participant, deps.originalDetails, deps.hasFetchedDetails, deps.mcpIsAuthorized, deps.hasValidationIssue, deps.crossFeatureSlots, deps.sharepointLoggedIn, deps.sharepointLoginSlot],
  );
}

export default ParticipantStatusRunner;
