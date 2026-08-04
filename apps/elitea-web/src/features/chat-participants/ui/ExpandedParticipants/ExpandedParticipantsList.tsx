// @ts-nocheck
/**
 * ExpandedParticipantsList — flat list renderer for expanded participant items.
 *
 * Ported from `[fsd]/features/chat/participants/ui/ExpandedParticipants/ExpandedParticipantsList.jsx`.
 */
import { memo } from 'react';

import { Box } from '@mui/material';

import { t } from '@/shared/ui/lib/t';

import { useParticipantEntityIcon } from '../../lib/hooks/useParticipantEntityIcon';

import ParticipantItem from './ParticipantItem';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExpandedParticipantsListProps {
  participants: Record<string, unknown>[];
  collapsed?: boolean;
  disabledEdit?: boolean;
  /** Currently active (selected) participant's unique id — drives per-item `isActive`. */
  activeParticipantId?: string;
  onItemClick?: (participant: Record<string, unknown>) => void;
  onDelete?: (participant: Record<string, unknown>) => void;
  onEdit?: (participant: Record<string, unknown>) => void;
  editingToolkit?: Record<string, unknown>;
  resolveToolkitIcon?: Parameters<typeof useParticipantEntityIcon>[0]['resolveToolkitIcon'];
  mcpLoginSlot?: React.ReactNode;
  mcpLogoutSlot?: React.ReactNode;
  sharepointLoginSlot?: React.ReactNode;
}

/**
 * Local, real-wire-value-safe port of old app's `getChatParticipantUniqueId`
 * (`participants.helpers.js:3-21`), used only to compute per-item `isActive`.
 *
 * NOT delegated to `entities/participant`'s `chatParticipantUniqueId` — that
 * selector still reads CAMELCASE fields (`entityName`/`entityMeta.id`)
 * against this feature's snake_case wire data (out of this cluster's scope
 * to fix, in `entities/participant/model/selectors.ts`), so it resolves to
 * the same degenerate string for every participant regardless of this
 * feature's own `ChatParticipantType` constant, which was separately fixed
 * to match real wire values (see wave-2 C5 adversarial-review finding #2).
 * This local helper reads the real wire shape directly.
 */
function uniqueIdEntityKey(participant: Record<string, unknown>, entitySettings: Record<string, unknown> | undefined): string {
  const rawEntityName = participant.entity_name as string | undefined;
  const isPipeline =
    rawEntityName === 'application' &&
    (entitySettings?.agent_type === 'pipeline' || participant.agent_type === 'pipeline');
  return (isPipeline ? 'pipeline' : rawEntityName) ?? '';
}

function uniqueIdBody(participant: Record<string, unknown>, entityMeta: Record<string, unknown> | undefined): string {
  if (participant.entity_name === 'llm') {
    return `${(entityMeta?.model_name as string | undefined) ?? ''}-${(entityMeta?.integration_uid as string | undefined) ?? ''}`;
  }
  return (entityMeta?.id as string | undefined) ?? '';
}

function participantUniqueId(participant: Record<string, unknown> | undefined): string {
  if (!participant) return '';
  const entityMeta = participant.entity_meta as Record<string, unknown> | undefined;
  const entitySettings = participant.entity_settings as Record<string, unknown> | undefined;
  const entityKey = uniqueIdEntityKey(participant, entitySettings);
  const body = uniqueIdBody(participant, entityMeta);
  return `${entityKey}_${body}_${(entityMeta?.project_id as string | undefined) ?? ''}`;
}

/**
 * ExpandedParticipantsList component — renders a flat list of expanded ParticipantItems.
 */
const ExpandedParticipantsList = memo((props: ExpandedParticipantsListProps): React.ReactElement => {
  const {
    participants,
    collapsed,
    disabledEdit,
    activeParticipantId,
    onItemClick,
    onDelete,
    onEdit,
    editingToolkit,
    resolveToolkitIcon,
    mcpLoginSlot,
    mcpLogoutSlot,
    sharepointLoginSlot,
  } = props;

  if (!participants?.length) return <Box sx={{ p: 1, textAlign: 'center', color: 'text.disabled' }}>{t('chat-participants.expanded.noParticipants', 'No participants')}</Box>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {participants.map((participant, index) => (
        <ParticipantItem
          key={`${String((participant.id as string) ?? index)}-${participant.entity_meta?.id ?? ''}`}
          participant={participant}
          collapsed={collapsed}
          disabledEdit={disabledEdit}
          isActive={activeParticipantId !== undefined && activeParticipantId === participantUniqueId(participant)}
          onClickItem={onItemClick}
          onDelete={onDelete}
          onEdit={onEdit}
          editingToolkit={editingToolkit}
          resolveToolkitIcon={resolveToolkitIcon}
          mcpLoginSlot={mcpLoginSlot}
          mcpLogoutSlot={mcpLogoutSlot}
          sharepointLoginSlot={sharepointLoginSlot}
        />
      ))}
    </Box>
  );
});

ExpandedParticipantsList.displayName = 'ExpandedParticipantsList';

export default ExpandedParticipantsList;
