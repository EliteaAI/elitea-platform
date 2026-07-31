// @ts-nocheck
/**
 * ParticipantItem — per-participant card (normal or attention/error state).
 * Ported from `[fsd]/features/chat/participants/ui/ExpandedParticipants/ParticipantItem.jsx`.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoIcon from '@mui/icons-material/Info';

import { t } from '@/shared/ui/lib/t';

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
  const theme = useTheme();
  const s = styles(theme);
  const {
    participant,
    disabledEdit,
    collapsed,
    isActive,
    onClickItem,
    onDelete,
    onEdit,
    editingToolkit,
    _disableTooltip,
    _isAttachment,
    hasMisconfigurationErrors,
    someToolsAreUnavailable,
    blockedToolkitNames,
    isPublishedAgentGone,
    isVersionUnavailable,
    mcpIsDisconnected,
    remoteMcpLoggedOut,
    hasRemoteMcpLoggedIn,
    spOAuthLoggedOut,
    _spOAuthLoggedIn,
    spConfig,
    shouldDisableThisItem,
    resolveToolkitIcon,
  } = props;

  const nameRef = useRef<HTMLSpanElement>(null);
  const [_nameIsOverflow, setNameIsOverflow] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const entityIcon = useParticipantEntityIcon(participant, { resolveToolkitIcon });
  const displayName = useParticipantName(participant);

  const entityMeta = participant.entity_meta as Record<string, unknown> | undefined;
  const entityName = participant.entity_name as ChatParticipantType | undefined;
  const entitySettings = participant.entity_settings as Record<string, unknown> | undefined;
  const _meta = participant.meta as Record<string, unknown> | undefined;

  // Pipeline detection (agent_type on entity_settings or top-level)
  const agentType = entitySettings?.agent_type as string | undefined;
  const _isPipelineParticipant = agentType === 'pipeline' || participant.agent_type === 'pipeline';

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
    <Box sx={s.infoMessageRow}>
      <Box sx={s.infoIcon}>
        <InfoIcon />
      </Box>
      <Typography variant="bodySmall" color="text.secondary" sx={s.attentionMessage}>
        {t('chat.participants.skippedContainer', 'This container agent is not active as an orchestrator and cannot run tools in adhoc chat.')}
      </Typography>
    </Box>
  ) : null;

  // Determine if we show normal or attention card
  const hasErrors = hasParticipantErrors({
    shouldDisableThisItem,
    hasMisconfigurationErrors,
    mcpIsDisconnected,
    remoteMcpLoggedOut,
    spOAuthLoggedOut,
    someToolsAreUnavailable,
    isVersionUnavailable,
    isPublishedAgentGone,
  });

  if (!hasErrors) return renderNormalCard({
    isActive, collapsed, displayName, entityIcon, entitySettings, versionName, isBeingEdited,
    s, onClickHandler, onMouseEnter: () => setIsHovering(true), onMouseLeave: () => setIsHovering(false),
    containerInfoRow,
  });

  return renderAttentionCard({
    isActive, collapsed, displayName, entityIcon, entitySettings, versionName, isBeingEdited, entityMeta,
    s, onClickHandler, onMouseEnter: () => setIsHovering(true), onMouseLeave: () => setIsHovering(false),
    containerInfoRow,
    shouldDisableThisItem, hasMisconfigurationErrors, mcpIsDisconnected,
    someToolsAreUnavailable, blockedToolkitNames, isVersionUnavailable,
    isPublishedAgentGone, remoteMcpLoggedOut, spOAuthLoggedOut, spConfig,
    handleEditClick, isToolkitParticipant,
  });
});

ParticipantItem.displayName = 'ParticipantItem';

// ---------------------------------------------------------------------------
// Helpers — keep the memo component body flat (complexity ≤ 12)
// ---------------------------------------------------------------------------

interface NormalCardProps {
  isActive: boolean; collapsed: boolean; displayName: string; entityIcon: { url?: string };
  entitySettings: Record<string, unknown> | undefined; versionName: string; isBeingEdited: boolean;
  s: ReturnType<typeof styles>; onClickHandler: () => void; onMouseEnter: () => void; onMouseLeave: () => void;
  containerInfoRow: React.ReactNode;
}

function renderNormalCard({
  isActive, collapsed, displayName, entityIcon, entitySettings, versionName, isBeingEdited,
  s, onClickHandler, onMouseEnter, onMouseLeave, containerInfoRow,
}: NormalCardProps): React.ReactElement | null {
  return (
    <Box sx={s.normalItemWrapper}>
      <Box onClick={onClickHandler} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} sx={s.contentWrapper(collapsed, isActive)}>
        <Box
          sx={{
            width: '1.5rem', height: '1.5rem', minWidth: '1.5rem',
            borderRadius: 'var(--el-radius-md)', backgroundColor: isActive ? 'action.selected' : 'background.paper',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--el-typography-body-small-font-size)', fontWeight: 600, overflow: 'hidden',
          }}
        >
          {entityIcon.url ? (
            <img src={entityIcon.url} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            (displayName[0] ?? '?').toUpperCase()
          )}
        </Box>

        {!collapsed && (
          <Box sx={s.nameWrapper}>
            <Typography variant="bodyMedium" color="text.secondary" sx={s.nameContent}>
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
            participant={{} as Record<string, unknown>}
            onEdit={() => {}} onDelete={() => {}}
            disabledEdit showButtons={isHovering}
            showEditButton={false} hasRemoteMcpLoggedIn
          />
        )}
      </Box>
      {containerInfoRow}
    </Box>
  );
}

interface AttentionCardProps {
  isActive: boolean; collapsed: boolean; displayName: string; entityIcon: { url?: string };
  entitySettings: Record<string, unknown> | undefined; versionName: string; isBeingEdited: boolean;
  entityMeta: Record<string, unknown> | undefined;
  s: ReturnType<typeof styles>; onClickHandler: () => void; onMouseEnter: () => void; onMouseLeave: () => void;
  containerInfoRow: React.ReactNode;
  shouldDisableThisItem: boolean | undefined; hasMisconfigurationErrors: boolean | undefined;
  mcpIsDisconnected: boolean | undefined; someToolsAreUnavailable: boolean | undefined;
  blockedToolkitNames: string[] | undefined; isVersionUnavailable: boolean | undefined;
  isPublishedAgentGone: boolean | undefined; remoteMcpLoggedOut: boolean | undefined;
  spOAuthLoggedOut: boolean | undefined; spConfig: unknown | null | undefined;
  handleEditClick: (e: React.MouseEvent) => void; isToolkitParticipant: boolean;
}

function renderAttentionCard({
  isActive, collapsed, displayName, entityIcon, isBeingEdited, entityMeta, s,
  onClickHandler, onMouseEnter, onMouseLeave, containerInfoRow,
  shouldDisableThisItem, hasMisconfigurationErrors, mcpIsDisconnected,
  someToolsAreUnavailable, blockedToolkitNames, isVersionUnavailable,
  isPublishedAgentGone, remoteMcpLoggedOut, spOAuthLoggedOut, spConfig,
  handleEditClick, isToolkitParticipant,
}: AttentionCardProps): React.ReactElement {
  return (
    <Box
      onClick={isActive || isVersionUnavailable ? onClickHandler : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      sx={s.attentionWrapper(isActive)}
    >
      <Box sx={s.attentionHeader}>
        <Box
          sx={{
            width: '1.5rem', height: '1.5rem', minWidth: '1.5rem',
            borderRadius: 'var(--el-radius-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--el-typography-body-small-font-size)', fontWeight: 600, overflow: 'hidden',
          }}
        >
          {entityIcon.url ? (
            <img src={entityIcon.url} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            (displayName[0] ?? '?').toUpperCase()
          )}
        </Box>
        {!collapsed && (
          <Box sx={s.attentionNameBox}>
            <Typography variant="bodyMedium" color="text.secondary" sx={s.attentionDisplayName}>
              {displayName}
            </Typography>
            {isBeingEdited && (
              <Typography variant="bodyMedium" color="primary.main" sx={s.attentionEditingText}>
                {entityMeta?.project_id === 'public' ? 'Viewing...' : 'Editing...'}
              </Typography>
            )}
          </Box>
        )}
      </Box>
      <Box sx={s.attentionMessageRow}>
        <Box sx={s.attentionIcon}>
          <WarningAmberIcon />
        </Box>
        <Typography variant="bodySmall" color="text.attention" sx={s.attentionMessage}>
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
            isSkippedContainer={false}
            handleEditClick={handleEditClick}
            isToolkitParticipant={isToolkitParticipant}
            spConfig={spConfig}
            mcpLoginSlot={undefined}
            sharepointLoginSlot={undefined}
          />
        </Typography>
      </Box>
      {containerInfoRow}
    </Box>
  );
}

function hasParticipantErrors(props: {
  shouldDisableThisItem?: boolean; hasMisconfigurationErrors?: boolean;
  mcpIsDisconnected?: boolean; remoteMcpLoggedOut?: boolean;
  spOAuthLoggedOut?: boolean; someToolsAreUnavailable?: boolean;
  isVersionUnavailable?: boolean; isPublishedAgentGone?: boolean;
}): boolean {
  return Boolean(
    props.shouldDisableThisItem
    || props.hasMisconfigurationErrors
    || props.mcpIsDisconnected
    || props.remoteMcpLoggedOut
    || props.spOAuthLoggedOut
    || props.someToolsAreUnavailable
    || props.isVersionUnavailable
    || props.isPublishedAgentGone,
  );
}


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = (theme: ReturnType<typeof useTheme>) => ({
  normalItemWrapper: { display: 'flex', flexDirection: 'column', width: '100%' },
  contentWrapper: (collapsed: boolean, isActive: boolean | undefined) => ({
    cursor: 'pointer',
    padding: collapsed ? '0 0' : '0.5rem 0.75rem',
    borderRadius: theme.vars.shape.radiusMd,
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
    borderRadius: theme.vars.shape.radiusMd,
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
});

export default ParticipantItem;
