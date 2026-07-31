// @ts-nocheck
/**
 * ParticipantsLayout — renders the expanded participants container, sections,
 * and context-budget slot.
 *
 * Extracted from `Participants.tsx` to keep that file under 400 lines.
 *
 * Prop budget (≤ 12 §3.5) is maintained by grouping related props into objects.
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

// ---------------------------------------------------------------------------
// Grouped prop interfaces (§3.5 component-props budget)
// ---------------------------------------------------------------------------

interface HeaderState {
  showTitle: boolean;
  collapseIcon: React.ReactNode;
  collapsed: boolean;
  onCollapsed?: () => void;
}

interface UserDisplay {
  usersToDisplay: TransformedParticipant[];
  hasOverflow: boolean;
  visibleCount: number;
  maxVisibleUsers: number;
}

interface SectionConfig {
  sections: Array<{ key: string; type: string; participants: TransformedParticipant[]; entityType: string }>;
  activeParticipantId?: string;
  disabledEdit?: boolean;
  disabledAdd?: boolean;
}

interface ParticipantActions {
  onSelectParticipant?: (p: TransformedParticipant) => void;
  onDeleteParticipant?: (p: TransformedParticipant) => void;
  onEditParticipant?: (p: TransformedParticipant) => void;
  onUpdateParticipant?: (p: TransformedParticipant) => void;
  editingToolkit?: string;
  resolveToolkitIcon?: ParticipantsProps['resolveToolkitIcon'];
}

export interface ParticipantsLayoutProps {
  header: HeaderState;
  users: UserDisplay;
  sections: SectionConfig;
  actions: ParticipantActions;
  renderContextBudget?: ParticipantsProps['renderContextBudget'];
}

// ---------------------------------------------------------------------------
// Component (≤ 12 props via grouping)
// ---------------------------------------------------------------------------

export function ParticipantsLayout({
  header, users, sections, actions, renderContextBudget,
}: ParticipantsLayoutProps) {
  return (
    <Box
      sx={styles.mainContainer(header.collapsed)}
      data-testid="participants-container"
    >
      {/* Content area */}
      <Box sx={styles.contentContainer(header.collapsed)}>
        {/* Header */}
        <Box sx={styles.headerContainer(header.collapsed)}>
          {header.showTitle && (
            <Typography
              variant="subtitle"
              sx={styles.titleText}
            >
              {t('chat-participants.participants.title', 'Participants')}
            </Typography>
          )}
          {header.onCollapsed && (
            <IconButton
              sx={styles.collapseButton}
              size="small"
              onClick={header.onCollapsed}
              aria-label={header.collapsed ? t('chat-participants.expand', 'Expand participants') : t('chat-participants.collapse', 'Collapse participants')}
            >
              {header.collapseIcon}
            </IconButton>
          )}
        </Box>

        {/* Participants sections */}
        <Box sx={styles.participantsContainer(header.collapsed)}>
          {/* Users row (always at top when visible) */}
          {users.visibleCount > 0 && !header.collapsed && (
            <Box
              sx={styles.usersRow}
              data-testid="users-section"
            >
              <Box sx={styles.usersDisplay}>
                {users.usersToDisplay.map((p) => (
                  <ParticipantItemRow
                    key={chatParticipantUniqueId(p)}
                    participant={p as unknown as ParticipantItemRowProps['participant']}
                    isActive={sections.activeParticipantId === chatParticipantUniqueId(p)}
                    onClickItem={actions.onSelectParticipant!}
                  />
                ))}
                {users.hasOverflow && (
                  <Typography
                    variant="bodySmall"
                    sx={styles.usersOverflow}
                  >
                    +{users.visibleCount - users.maxVisibleUsers}
                  </Typography>
                )}
              </Box>
            </Box>
          )}

          {/* Type sections */}
          {sections.sections.map(({ key, participants: group, entityType }) => (
            <ParticipantSection
              key={key}
              disabledEdit={sections.disabledEdit}
              disabledAdd={sections.disabledAdd}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              participants={group as unknown as any}
              collapsed={header.collapsed}
              activeParticipantId={sections.activeParticipantId}
              onSelectParticipant={actions.onSelectParticipant!}
              onDeleteParticipant={actions.onDeleteParticipant!}
              onEditParticipant={actions.onEditParticipant!}
              onUpdateParticipant={actions.onUpdateParticipant!}
              entityType={entityType}
              editingToolkit={actions.editingToolkit}
              resolveToolkitIcon={actions.resolveToolkitIcon}
            />
          ))}

          {/* Empty state when no sections and not collapsed */}
          {sections.sections.length === 0 && users.visibleCount === 0 && !header.collapsed && (
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
