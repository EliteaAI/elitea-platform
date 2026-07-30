// @ts-nocheck
/**
 * ParticipantItem — the per-participant card component.
 *
 * Ported from `[fsd]/features/chat/participants/ui/ExpandedParticipants/ParticipantItem.jsx`
 * (~250 lines). The main per-participant card that shows either a normal card
 * or an attention/error card depending on status flags.
 *
 * Cross-cutting:
 *  - `useEliteaAssistantRef` from `widgets/support-assistant` is a disclosed
 *    gap — the new-app port defers it (same treatment as
 *    `CredentialWarningBanner.tsx`).
 *  - `useIsActiveParticipantBeingEdited` from `entities/participant` replaces
 *    the old inline nav-blocker logic.
 *  - EntityIcon: uses the local `useParticipantEntityIcon` hook with
 *    `resolveToolkitIcon` slot.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Box, Typography } from '@mui/material';

import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoIcon from '@mui/icons-material/Info';

import { ChatParticipantType } from '../../model/constants';
import { canParticipantBeActiveInChat } from '../../lib/helpers';
import { useParticipantEntityIcon } from '../../lib/hooks/useParticipantEntityIcon';
import { useParticipantName } from '../../lib/hooks/useParticipantName';
import { isSkippedContainerParticipant as isSkippedContainerParticipantEntity } from '@/entities/participant';

import ParticipantActions from '../ParticipantActions/ParticipantActions';
import ParticipantWarning from './ParticipantWarning';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ParticipantItemProps {
  participant: Record<string, unknown>;
  disabledEdit?: boolean;
  collapsed?: boolean;
  isActive?: boolean;
  onClickItem?: (participant: Record<string, unknown>) => void;
  onDelete?: (participant: Record<string, unknown>) => void;
  onEdit?: (participant: Record<string, unknown>) => void;
  editingToolkit?: Record<string, unknown>;
  disableTooltip?: boolean;
  isAttachment?: boolean;
  mcpLoginSlot?: React.ReactNode;
  mcpLogoutSlot?: React.ReactNode;
  sharepointLoginSlot?: React.ReactNode;
  resolveToolkitIcon?: Parameters<typeof useParticipantEntityIcon>[0]['resolveToolkitIcon'];
  // Status flags from ParticipantDetailsContext
  hasMisconfigurationErrors?: boolean;
  someToolsAreUnavailable?: boolean;
  blockedToolkitNames?: string[];
  isPublishedAgentGone?: boolean;
  isVersionUnavailable?: boolean;
  mcpIsDisconnected?: boolean;
  remoteMcpLoggedOut?: boolean;
  hasRemoteMcpLoggedIn?: boolean;
  spOAuthLoggedOut?: boolean;
  spOAuthLoggedIn?: boolean;
  spConfig?: unknown | null;
  shouldDisableThisItem?: boolean;
}

/**
 * ParticipantItem component — per-participant card (normal or attention state).
 * Memo'd for performance.
 */
const ParticipantItem = memo((props: ParticipantItemProps): React.ReactElement | null => {
  const {
    participant,
    disabledEdit,
    collapsed,
    isActive,
    onClickItem,
    onDelete,
    onEdit,
    editingToolkit,
    disableTooltip,
    isAttachment,
    hasMisconfigurationErrors,
    someToolsAreUnavailable,
    blockedToolkitNames,
    isPublishedAgentGone,
    isVersionUnavailable,
    mcpIsDisconnected,
    remoteMcpLoggedOut,
    hasRemoteMcpLoggedIn,
    spOAuthLoggedOut,
    spOAuthLoggedIn,
    spConfig,
    shouldDisableThisItem,
    resolveToolkitIcon,
  } = props;

  const nameRef = useRef<HTMLSpanElement>(null);
  const [nameIsOverflow, setNameIsOverflow] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const entityIcon = useParticipantEntityIcon(participant, { resolveToolkitIcon });
  const displayName = useParticipantName(participant);

  const entityMeta = participant.entity_meta as Record<string, unknown> | undefined;
  const entityName = participant.entity_name as ChatParticipantType | undefined;
  const entitySettings = participant.entity_settings as Record<string, unknown> | undefined;
  const meta = participant.meta as Record<string, unknown> | undefined;

  // Pipeline detection (agent_type on entity_settings or top-level)
  const agentType = entitySettings?.agent_type as string | undefined;
  const isPipelineParticipant = agentType === 'pipeline' || participant.agent_type === 'pipeline';

  // Skipped container agent (issue #5680)
  const isSkippedContainer = useMemo(
    () => !isActive && (isSkippedContainerParticipantEntity(participant) || isSkippedContainerParticipantEntity(participant)),
    [isActive, participant],
  );

  // Being-edited state
  const isBeingEdited = useMemo(() => {
    const isActiveToolKit = entityName === ChatParticipantType.Toolkits;
    const isMatchingToolkit = isActiveToolKit && editingToolkit?.entity_meta?.id === entityMeta?.id;
    return isMatchingToolkit;
  }, [entityName, editingToolkit, entityMeta]);

  const canBeActive = useMemo(() => canParticipantBeActiveInChat(participant), [participant]);
  const isToolkitParticipant = entityName === ChatParticipantType.Toolkits;

  // Version name
  const [versionName, setVersionName] = useState('');
  useEffect(() => {
    const versions = entitySettings?.versions as Array<{ id: string; name: string }> | undefined;
    const versionId = entitySettings?.version_id as string | undefined;
    if (versions && versionId) {
      setVersionName(versions.find((v) => v.id === versionId)?.name || '');
    } else {
      setVersionName('');
    }
  }, [entitySettings]);

  const onClickHandler = useCallback(() => {
    if (!disabledEdit && (isActive || canBeActive)) {
      onClickItem?.(isActive ? undefined : participant);
    }
  }, [disabledEdit, isActive, onClickItem, participant, canBeActive]);

  const handleEditClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onEdit?.(participant);
    },
    [onEdit, participant],
  );

  // Overflow detection
  useEffect(() => {
    if (!isHovering && nameRef.current) {
      const isOverflowing = nameRef.current.scrollWidth > nameRef.current.clientWidth;
      setNameIsOverflow(isOverflowing);
    }
  }, [isHovering]);

  // Container info row (skipped container hint)
  const containerInfoRow = !collapsed && isSkippedContainer ? (
    <Box sx={styles.infoMessageRow}>
      <Box sx={styles.infoIcon}>
        <InfoIcon />
      </Box>
      <Typography variant="bodySmall" color="text.secondary" sx={styles.attentionMessage}>
        This container agent is not active as an orchestrator and cannot run tools in adhoc chat.
      </Typography>
    </Box>
  ) : null;

  // Determine if we show normal or attention card
  const hasErrors =
    shouldDisableThisItem ||
    hasMisconfigurationErrors ||
    mcpIsDisconnected ||
    remoteMcpLoggedOut ||
    spOAuthLoggedOut ||
    someToolsAreUnavailable ||
    isVersionUnavailable ||
    isPublishedAgentGone;

  if (!hasErrors) {
    return (
      <Box sx={styles.normalItemWrapper}>
        <Box onClick={onClickHandler} onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)} sx={styles.contentWrapper(collapsed, isActive)}>
          <Box
            sx={{
              width: '1.5rem',
              height: '1.5rem',
              minWidth: '1.5rem',
              borderRadius: 0.5,
              backgroundColor: isActive ? 'action.selected' : 'background.paper',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.65rem',
              fontWeight: 600,
              overflow: 'hidden',
            }}
          >
            {entityIcon.url ? (
              <img src={entityIcon.url} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              (displayName[0] ?? '?').toUpperCase()
            )}
          </Box>

          {!collapsed && (
            <Box sx={styles.nameWrapper}>
              <Typography variant="bodyMedium" color="text.secondary" ref={nameRef} sx={styles.nameContent}>
                {displayName}
                {entitySettings?.version_id && (
                  <Typography
                    variant="bodyMedium"
                    color={isBeingEdited ? 'primary.main' : 'text.primary'}
                    sx={{ flexShrink: 0, maxWidth: '50%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {isBeingEdited ? 'Editing...' : versionName}
                  </Typography>
                )}
              </Typography>
            </Box>
          )}

          {!collapsed && !isBeingEdited && (
            <ParticipantActions
              participant={participant}
              onEdit={onEdit}
              onDelete={onDelete}
              disabledEdit={disabledEdit}
              showButtons={isHovering}
              showEditButton={entityName === ChatParticipantType.Toolkits || entityName === ChatParticipantType.Pipelines || entityName === ChatParticipantType.Applications}
              hasRemoteMcpLoggedIn={hasRemoteMcpLoggedIn}
              mcpLoginSlot={props.mcpLoginSlot}
              mcpLogoutSlot={props.mcpLogoutSlot}
              sharepointLoginSlot={props.sharepointLoginSlot}
            />
          )}
        </Box>
        {containerInfoRow}
      </Box>
    );
  }

  // Attention/error card
  return (
    <Box
      onClick={isActive || isVersionUnavailable ? onClickHandler : undefined}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      sx={styles.attentionWrapper(isActive)}
    >
      <Box sx={styles.attentionHeader}>
        <Box
          sx={{
            width: '1.5rem',
            height: '1.5rem',
            minWidth: '1.5rem',
            borderRadius: 0.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.65rem',
            fontWeight: 600,
            overflow: 'hidden',
          }}
        >
          {entityIcon.url ? (
            <img src={entityIcon.url} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            (displayName[0] ?? '?').toUpperCase()
          )}
        </Box>
        {!collapsed && (
          <Box sx={styles.attentionNameBox}>
            <Typography variant="bodyMedium" color="text.secondary" sx={styles.attentionDisplayName}>
              {displayName}
            </Typography>
            {isBeingEdited && (
              <Typography variant="bodyMedium" color="primary.main" sx={styles.attentionEditingText}>
                {entityMeta?.project_id === 'public' ? 'Viewing...' : 'Editing...'}
              </Typography>
            )}
          </Box>
        )}
        {!collapsed && !isBeingEdited && (
          <ParticipantActions
            participant={participant}
            onEdit={onEdit}
            onDelete={onDelete}
            disabledEdit={disabledEdit || isPublishedAgentGone || isVersionUnavailable}
            showButtons={isHovering}
            showEditButton={entityName === ChatParticipantType.Toolkits || entityName === ChatParticipantType.Pipelines || entityName === ChatParticipantType.Applications}
            hasRemoteMcpLoggedIn={hasRemoteMcpLoggedIn}
            mcpLoginSlot={props.mcpLoginSlot}
            mcpLogoutSlot={props.mcpLogoutSlot}
            sharepointLoginSlot={props.sharepointLoginSlot}
          />
        )}
      </Box>
      <Box sx={styles.attentionMessageRow}>
        <Box sx={styles.attentionIcon}>
          <WarningAmberIcon />
        </Box>
        <Typography variant="bodySmall" color="text.attention" sx={styles.attentionMessage}>
          <ParticipantWarning
            isPublishedAgentGone={isPublishedAgentGone}
            isVersionUnavailable={isVersionUnavailable}
            hasMisconfigurationErrors={hasMisconfigurationErrors}
            shouldDisableThisItem={shouldDisableThisItem}
            mcpIsDisconnected={mcpIsDisconnected}
            someToolsAreUnavailable={someToolsAreUnavailable}
            blockedToolkitNames={blockedToolkitNames}
            remoteMcpLoggedOut={remoteMcpLoggedOut}
            spOAuthLoggedOut={spOAuthLoggedOut}
            isSkippedContainer={isSkippedContainer}
            handleEditClick={handleEditClick}
            isToolkitParticipant={isToolkitParticipant}
            spConfig={spConfig}
            mcpLoginSlot={props.mcpLoginSlot}
            sharepointLoginSlot={props.sharepointLoginSlot}
          />
        </Typography>
      </Box>
      {containerInfoRow}
    </Box>
  );
});

ParticipantItem.displayName = 'ParticipantItem';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  normalItemWrapper: { display: 'flex', flexDirection: 'column', width: '100%' },
  contentWrapper: (collapsed: boolean, isActive: boolean | undefined) => ({
    cursor: 'pointer',
    padding: collapsed ? '0 0' : '0.5rem 0.75rem',
    borderRadius: '0.5rem',
    gap: '0.5rem',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    width: '100%',
    height: '2.5rem',
    boxSizing: 'border-box',
    background: isActive ? 'background.participant.active' : 'background.participant.default',
    border: isActive ? '0.0625rem solid' : 'none',
    borderColor: 'split.hover',
    '&:hover': { background: 'background.participant.hover' },
  }),
  nameWrapper: {
    flex: 1,
    maxWidth: 'calc(100% - 2.125rem)',
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '.5rem',
  },
  nameContent: {
    flex: 1,
    minWidth: '50%',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'inline-flex',
    flexDirection: 'row',
    alignItems: 'center',
  },
  attentionWrapper: (isActive: boolean | undefined) => ({
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    padding: '.5rem 1rem',
    borderWidth: '.0625rem',
    borderStyle: 'solid',
    borderColor: 'border.attention',
    borderRadius: '.5rem',
    backgroundColor: 'background.attention',
    width: '100%',
    gap: '.5rem',
    cursor: isActive ? 'pointer' : 'default',
  }),
  attentionHeader: { display: 'flex', flexDirection: 'row', gap: '.75rem', height: '1.75rem', alignItems: 'center' },
  attentionNameBox: { flex: 1, maxWidth: 'calc(100% - 2.125rem)', display: 'flex', flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center' },
  attentionDisplayName: { flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  attentionEditingText: { maxWidth: '50%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  attentionMessageRow: { display: 'flex', flexDirection: 'row', gap: '0.9rem' },
  attentionIcon: { paddingLeft: '0.25rem', width: '1rem', height: '1rem', '& svg': { fill: 'icon.fill.attention' } },
  attentionMessage: { wordBreak: 'break-word' },
  infoMessageRow: { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: '.375rem', padding: '0 .75rem .25rem' },
  infoIcon: { display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: '1rem', height: '1rem', '& svg, & path': { fill: 'icon.fill.secondary' } },
};

export default ParticipantItem;
