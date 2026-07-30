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
  spConfig?: unknown | null;
  mcpLoginSlot?: ReactNode;
  sharepointLoginSlot?: ReactNode;
}

/**
 * Computes the warning text for a participant based on its error conditions.
 * Ported from `ParticipantWarning.jsx` (the entire component's rendering logic).
 */
function getWarningText(props: ParticipantWarningProps): ReactNode {
  const {
    isPublishedAgentGone,
    isVersionUnavailable,
    hasMisconfigurationErrors,
    shouldDisableThisItem,
    mcpIsDisconnected,
    someToolsAreUnavailable,
    blockedToolkitNames,
    remoteMcpLoggedOut,
    spOAuthLoggedOut,
    isSkippedContainer,
    handleEditClick,
    isToolkitParticipant,
    spConfig,
  } = props;

  // Skipped container info — informational, not an error
  if (isSkippedContainer) {
    return 'This container agent is not active as an orchestrator and cannot run tools in adhoc chat.';
  }

  // Published agent gone
  if (isPublishedAgentGone) {
    return 'This published agent has been removed.';
  }

  // Version unavailable
  if (isVersionUnavailable) {
    return 'The selected version is no longer available.';
  }

  // MCP disconnected
  if (mcpIsDisconnected && isToolkitParticipant) {
    const mcpLoginSlot = (props as ParticipantWarningProps).mcpLoginSlot;
    if (remoteMcpLoggedOut && mcpLoginSlot) {
      return (
        <>
          MCP server disconnected.{' '}
          <Typography component="span" sx={{ cursor: 'pointer', color: 'primary.main', textDecoration: 'underline' }} onClick={() => {}}>
            Reconnect
          </Typography>{' '}
          to restore connection.
        </>
      );
    }
    return 'MCP server is currently disconnected.';
  }

  // Remote MCP logged out
  if (remoteMcpLoggedOut && isToolkitParticipant) {
    const mcpLoginSlot = (props as ParticipantWarningProps).mcpLoginSlot;
    if (mcpLoginSlot) {
      return (
        <>
          Remote MCP session expired.{' '}
          <Typography component="span" sx={{ cursor: 'pointer', color: 'primary.main', textDecoration: 'underline' }} onClick={() => {}}>
            Login
          </Typography>{' '}
          to reconnect.
        </>
      );
    }
    return 'Remote MCP session expired.';
  }

  // SharePoint OAuth logged out
  if (spOAuthLoggedOut && spConfig) {
    const sharepointLoginSlot = (props as ParticipantWarningProps).sharepointLoginSlot;
    if (sharepointLoginSlot) {
      return (
        <>
          SharePoint OAuth session expired.{' '}
          <Typography component="span" sx={{ cursor: 'pointer', color: 'primary.main', textDecoration: 'underline' }} onClick={() => {}}>
            Login
          </Typography>{' '}
          to reconnect.
        </>
      );
    }
    return 'SharePoint OAuth session expired.';
  }

  // Misconfiguration errors
  if (hasMisconfigurationErrors) {
    if (handleEditClick) {
      return (
        <>
          This participant has configuration issues.{' '}
          <Typography component="span" sx={{ cursor: 'pointer', color: 'primary.main', textDecoration: 'underline' }} onClick={handleEditClick}>
            Fix configuration
          </Typography>
        </>
      );
    }
    return 'This participant has configuration issues.';
  }

  // Tools unavailable
  if (someToolsAreUnavailable) {
    return 'Some tools available in this toolkit\'s schema are not available on your organization\'s instance.';
  }

  // Blocked toolkit types
  if (blockedToolkitNames && blockedToolkitNames.length > 0) {
    return `The following toolkit types are blocked by your organization's guardrails: ${blockedToolkitNames.join(', ')}.`;
  }

  // Should disable
  if (shouldDisableThisItem) {
    return 'This participant cannot be added to the chat.';
  }

  return null;
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
