// @ts-nocheck
/**
 * ParticipantsLayout — renders the expanded participants container, sections,
 * and context-budget slot.
 *
 * Extracted from `Participants.tsx` to keep that file under 400 lines.
 */
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/ui/lib/t';

import type { TransformedParticipant } from '../model/types';
import { chatParticipantUniqueId } from '@/entities/participant';
import { styles } from './ExpandedParticipants/participants.styles';
import ParticipantItemRow from './ExpandedParticipants/ParticipantItemRow';
import ParticipantSection from './ExpandedParticipants/ParticipantSection';
import type { ParticipantsProps } from './Participants.types';

export function ParticipantsLayout({
  showTitle, collapseIcon, collapsed, onCollapsed,
  renderContextBudget,
  usersToDisplay, hasOverflow, visibleCount, maxVisibleUsers,
  sections, activeParticipantId, disabledEdit, disabledAdd,
  onSelectParticipant, onDeleteParticipant, onEditParticipant, onUpdateParticipant,
  editingToolkit, resolveToolkitIcon,
}: {
  showTitle: boolean;
  collapseIcon: React.ReactNode;
  collapsed: boolean;
  onCollapsed?: () => void;
  usersToDisplay: TransformedParticipant[];
  hasOverflow: boolean;
  visibleCount: number;
  maxVisibleUsers: number;
  sections: Array<{ key: string; type: string; participants: TransformedParticipant[]; entityType: string }>;
  activeParticipantId?: string;
  disabledEdit?: boolean;
  disabledAdd?: boolean;
  onSelectParticipant?: (p: TransformedParticipant) => void;
  onDeleteParticipant?: (p: TransformedParticipant) => void;
  onEditParticipant?: (p: TransformedParticipant) => void;
  onUpdateParticipant?: (p: TransformedParticipant) => void;
  editingToolkit?: string;
  resolveToolkitIcon?: ParticipantsProps['resolveToolkitIcon'];
  renderContextBudget?: ParticipantsProps['renderContextBudget'];
}) {
  return (
    <Box
      sx={styles.mainContainer(collapsed)}
      data-testid="participants-container"
    >
      {/* Content area */}
      <Box sx={styles.contentContainer(collapsed)}>
        {/* Header */}
        <Box sx={styles.headerContainer(collapsed)}>
          {showTitle && (
            <Typography
              variant="subtitle"
              sx={styles.titleText}
            >
              {t('chat-participants.participants.title', 'Participants')}
            </Typography>
          )}
          {onCollapsed && (
            <IconButton
              sx={styles.collapseButton}
              size="small"
              onClick={onCollapsed}
              aria-label={collapsed ? t('chat-participants.expand', 'Expand participants') : t('chat-participants.collapse', 'Collapse participants')}
            >
              {collapseIcon}
            </IconButton>
          )}
        </Box>

        {/* Participants sections */}
        <Box sx={styles.participantsContainer(collapsed)}>
          {/* Users row (always at top when visible) */}
          {visibleCount > 0 && !collapsed && (
            <Box
              sx={styles.usersRow}
              data-testid="users-section"
            >
              <Box sx={styles.usersDisplay}>
                {usersToDisplay.map((p) => (
                  <ParticipantItemRow
                    key={chatParticipantUniqueId(p)}
                    participant={p as unknown as ParticipantItemRowProps['participant']}
                    isActive={activeParticipantId === chatParticipantUniqueId(p)}
                    onClickItem={onSelectParticipant!}
                  />
                ))}
                {hasOverflow && (
                  <Typography
                    variant="bodySmall"
                    sx={styles.usersOverflow}
                  >
                    +{visibleCount - maxVisibleUsers}
                  </Typography>
                )}
              </Box>
            </Box>
          )}

          {/* Type sections */}
          {sections.map(({ key, participants: group, entityType }) => (
            <ParticipantSection
              key={key}
              disabledEdit={disabledEdit}
              disabledAdd={disabledAdd}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              participants={group as unknown as any}
              collapsed={collapsed}
              activeParticipantId={activeParticipantId}
              onSelectParticipant={onSelectParticipant!}
              onDeleteParticipant={onDeleteParticipant!}
              onEditParticipant={onEditParticipant!}
              onUpdateParticipant={onUpdateParticipant!}
              entityType={entityType}
              editingToolkit={editingToolkit}
              resolveToolkitIcon={resolveToolkitIcon}
            />
          ))}

          {/* Empty state when no sections and not collapsed */}
          {sections.length === 0 && visibleCount === 0 && !collapsed && (
            <Typography
              variant="bodySmall"
              color="text.secondary"
              sx={styles.emptyState}
            >
              {t('chat-participants.expanded.noParticipants', 'No participants')}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Context budget slot */}
      {renderContextBudget && (
        <Box sx={styles.contextBudgetWrapper}>
          {renderContextBudget({
            conversationId: undefined,
          })}
        </Box>
      )}
    </Box>
  );
}

ParticipantsLayout.displayName = 'ParticipantsLayout';
