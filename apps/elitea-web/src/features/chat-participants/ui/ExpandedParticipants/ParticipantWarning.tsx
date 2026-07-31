// @ts-nocheck
/**
 * ParticipantWarning — renders warning messages for various participant error
 * conditions.
 *
 * Ported from `[fsd]/features/chat/participants/ui/ExpandedParticipants/ParticipantWarning.jsx`.
 *
 * Cross-cutting note: the old app imported `McpLogInLink` from `features/mcp/ui`
 * and `SharepointLogInLink` from `features/sharepoint/ui`. New-app port uses
 * slot props (`mcpLoginSlot`, `sharepointLoginSlot`) supplied by the consumer.
 * See `ToolCardDelegatedAuthProps` in `features/agents/ui/ToolCard.types.ts`
 * for the established slot-prop pattern.
 */
import { memo, type ReactNode } from 'react';

import { Typography } from '@mui/material';

import { t } from '@/shared/ui/lib/t';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ParticipantWarningProps {
  isPublishedAgentGone?: boolean;
  isVersionUnavailable?: boolean;
  hasMisconfigurationErrors?: boolean;
  shouldDisableThisItem?: boolean;
  mcpIsDisconnected?: boolean;
  someToolsAreUnavailable?: boolean;
  blockedToolkitNames?: string[];
  remoteMcpLoggedOut?: boolean;
  spOAuthLoggedOut?: boolean;
  isSkippedContainer?: boolean;
  participant?: Record<string, unknown>;
  handleEditClick?: (event: React.MouseEvent) => void;
  isToolkitParticipant?: boolean;
  type?: string;
  originalDetails?: Record<string, unknown>;
  entityMeta?: Record<string, unknown>;
  spConfig?: unknown;
  mcpLoginSlot?: ReactNode;
  sharepointLoginSlot?: ReactNode;
}

// ---------------------------------------------------------------------------
// Warning text resolvers — each handles one condition (complexity ≤ 3)
// ---------------------------------------------------------------------------

function resolveSkippedContainer(): ReactNode {
  return t(
    'chat-participants.warning.skippedContainer',
    'This container agent is not active as an orchestrator and cannot run tools in adhoc chat.',
  );
}

function resolvePublishedAgentGone(): ReactNode {
  return t(
    'chat-participants.warning.publishedAgentGone',
    'This published agent has been removed.',
  );
}

function resolveVersionUnavailable(): ReactNode {
  return t(
    'chat-participants.warning.versionUnavailable',
    'The selected version is no longer available.',
  );
}

function resolveMcpDisconnected(
  mcpLoginSlot: ReactNode | undefined,
  remoteMcpLoggedOut: boolean,
): ReactNode {
  if (remoteMcpLoggedOut && mcpLoginSlot) {
    return (
      <>
        {t('chat-participants.warning.mcpDisconnected', 'MCP server disconnected. ')}
        <Typography component="span" sx={{ cursor: 'pointer', color: 'primary.main', textDecoration: 'underline' }} onClick={() => {}}>
          {t('chat-participants.warning.reconnect', 'Reconnect')}
        </Typography>{' '}
        {t('chat-participants.warning.restoreConnection', 'to restore connection.')}
      </>
    );
  }
  return t('chat-participants.warning.mcpDisconnected', 'MCP server is currently disconnected.');
}

function resolveRemoteMcpExpired(mcpLoginSlot: ReactNode | undefined): ReactNode {
  if (mcpLoginSlot) {
    return (
      <>
        {t('chat-participants.warning.remoteMcpExpired', 'Remote MCP session expired. ')}
        <Typography component="span" sx={{ cursor: 'pointer', color: 'primary.main', textDecoration: 'underline' }} onClick={() => {}}>
          {t('chat-participants.warning.login', 'Login')}
        </Typography>{' '}
        {t('chat-participants.warning.reconnect', 'to reconnect.')}
      </>
    );
  }
  return t('chat-participants.warning.remoteMcpExpired', 'Remote MCP session expired.');
}

function resolveSpOAuthExpired(sharepointLoginSlot: ReactNode | undefined): ReactNode {
  if (sharepointLoginSlot) {
    return (
      <>
        {t('chat-participants.warning.sharepointExpired', 'SharePoint OAuth session expired. ')}
        <Typography component="span" sx={{ cursor: 'pointer', color: 'primary.main', textDecoration: 'underline' }} onClick={() => {}}>
          {t('chat-participants.warning.login', 'Login')}
        </Typography>{' '}
        {t('chat-participants.warning.reconnect', 'to reconnect.')}
      </>
    );
  }
  return t('chat-participants.warning.sharepointExpired', 'SharePoint OAuth session expired.');
}

function resolveConfigIssues(handleEditClick: (() => void) | undefined): ReactNode {
  if (handleEditClick) {
    return (
      <>
        {t('chat-participants.warning.configIssues', 'This participant has configuration issues. ')}
        <Typography component="span" sx={{ cursor: 'pointer', color: 'primary.main', textDecoration: 'underline' }} onClick={handleEditClick}>
          {t('chat-participants.warning.fixConfiguration', 'Fix configuration')}
        </Typography>
      </>
    );
  }
  return t('chat-participants.warning.configIssues', 'This participant has configuration issues.');
}

function resolveToolsUnavailable(): ReactNode {
  return t(
    'chat-participants.warning.toolsUnavailable',
    'Some tools available in this toolkit\'s schema are not available on your organization\'s instance.',
  );
}

function resolveBlockedToolkitNames(blockedToolkitNames: string[]): ReactNode {
  return t(
    'chat-participants.warning.blockedToolkitTypes',
    'The following toolkit types are blocked by your organization\'s guardrails: ',
  ).concat(blockedToolkitNames.join(', '), '.');
}

function resolveCannotBeAdded(): ReactNode {
  return t(
    'chat-participants.warning.cannotBeAdded',
    'This participant cannot be added to the chat.',
  );
}

// ---------------------------------------------------------------------------
// getWarningText — orchestrator (complexity ≤ 8)
// ---------------------------------------------------------------------------

/**
 * Computes the warning text for a participant based on its error conditions.
 * Ported from `ParticipantWarning.jsx` (the entire component's rendering logic).
 */
function getWarningText(props: ParticipantWarningProps): ReactNode {
  const {
    isSkippedContainer,
    isPublishedAgentGone,
    isVersionUnavailable,
    mcpIsDisconnected,
    isToolkitParticipant,
    remoteMcpLoggedOut,
    spOAuthLoggedOut,
    spConfig,
    hasMisconfigurationErrors,
    someToolsAreUnavailable,
    blockedToolkitNames,
    shouldDisableThisItem,
    handleEditClick,
    mcpLoginSlot,
    sharepointLoginSlot,
  } = props;

  if (isSkippedContainer) return resolveSkippedContainer();
  if (isPublishedAgentGone) return resolvePublishedAgentGone();
  if (isVersionUnavailable) return resolveVersionUnavailable();

  // MCP checks — extract combined condition to avoid && in if
  if (checkMcpDisconnected(mcpIsDisconnected, isToolkitParticipant)) {
    return resolveMcpDisconnected(mcpLoginSlot, remoteMcpLoggedOut);
  }
  if (checkRemoteMcpLoggedOut(remoteMcpLoggedOut, isToolkitParticipant)) {
    return resolveRemoteMcpExpired(mcpLoginSlot);
  }
  if (checkSpOAuthExpired(spOAuthLoggedOut, spConfig)) {
    return resolveSpOAuthExpired(sharepointLoginSlot);
  }

  if (hasMisconfigurationErrors) return resolveConfigIssues(handleEditClick);
  if (someToolsAreUnavailable) return resolveToolsUnavailable();
  if (blockedToolkitNames?.length) return resolveBlockedToolkitNames(blockedToolkitNames);
  if (shouldDisableThisItem) return resolveCannotBeAdded();

  return null;
}

// ---------------------------------------------------------------------------
// Helper: combine boolean flags (complexity ≤ 2)
// ---------------------------------------------------------------------------

function checkMcpDisconnected(mcpIsDisconnected: boolean | undefined, isToolkitParticipant: boolean | undefined): boolean {
  return mcpIsDisconnected && isToolkitParticipant;
}

function checkRemoteMcpLoggedOut(remoteMcpLoggedOut: boolean | undefined, isToolkitParticipant: boolean | undefined): boolean {
  return remoteMcpLoggedOut && isToolkitParticipant;
}

function checkSpOAuthExpired(spOAuthLoggedOut: boolean | undefined, spConfig: unknown): boolean {
  return spOAuthLoggedOut && spConfig;
}

/**
 * ParticipantWarning component — renders warning messages for participant errors.
 * Memo'd for performance.
 */
const ParticipantWarning = memo((props: ParticipantWarningProps): React.ReactElement | null => {
  const warningText = getWarningText(props);
  if (!warningText) return null;

  return (
    <Typography variant="bodySmall" color="text.attention" sx={{ wordBreak: 'break-word' }}>
      {warningText}
    </Typography>
  );
});

ParticipantWarning.displayName = 'ParticipantWarning';

export default ParticipantWarning;
