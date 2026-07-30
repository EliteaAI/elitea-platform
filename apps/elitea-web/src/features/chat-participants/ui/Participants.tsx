// @ts-nocheck
/**
 * ui/Participants.tsx — Groups participants by type into sections.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/participants/ui/Participants.jsx`
 * (old-app) and `ExpandedParticipantsList.jsx` / `ParticipantSection.jsx` (FSD
 * sub-components), adapted to the new-app component model:
 *  - `participants` comes from the consumer (the chat page component), not
 *    fetched internally.
 *  - MCP visibility is gate-checked via an optional `isMcpVisible` prop so
 *    this unit does not import `features/mcp` or `shared/lib/hooks` directly.
 *  - Context-budget / instructions rendering is injected via the
 *    `renderContextBudget` slot (same pattern as `features/pipelines/ui/
 *    ChatPanel.tsx`'s `renderContextBudget`).
 *  - `ParticipantDetailsProvider` is NOT rendered here — it must be provided
 *    by the wrapper so consumers can control which participant set feeds the
 *    detail cache.
 *
 * Cross-cutting gaps:
 *  - `renderContextBudget` — slot for the context-budget widget
 *    (`@/[fsd]/widgets/context-budget`). See `features/pipelines/ui/
 *    ChatPanel.tsx` for the exact shape and usage pattern.
 *  - `resolveToolkitIcon` — optional slot to resolve toolkit/MCP icons.
 *    Falls back to a generic icon when not provided.
 */

import { memo, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import Typography from '@mui/material/Typography';

import { ChatParticipantType } from '../model/constants';
import type { TransformedParticipant } from '../model/types';
import { useParticipantEntityIcon } from '../lib/hooks/useParticipantEntityIcon';
import { isParticipantStillActive } from '@/entities/participant';
import { useParticipantName } from '../lib/hooks/useParticipantName';
import { chatParticipantUniqueId } from '@/entities/participant';
import { styles } from './ExpandedParticipants/participants.styles';
import ParticipantItemRow from './ExpandedParticipants/ParticipantItemRow';

/**
 * `mcp.helpers.js:7-14`'s `isMcpToolkitType`, duplicated here for the same
 * reason `useSlashMention.ts`'s copy is — no shared home exists in this
 * worktree. `type === 'mcp'` or a `mcp_*` pre-built type.
 */
function isMcpToolkitType(type: string): boolean {
  return type === 'mcp' || type.startsWith('mcp_');
}

import ParticipantSection from './ExpandedParticipants/ParticipantSection';

// ---------------------------------------------------------------------------
// Type-level groupings
// ---------------------------------------------------------------------------

/** Order in which participant types appear in the expanded list. */
const ENTITY_ORDER: Array<ChatParticipantType | 'mcp'> = [
  ChatParticipantType.Users,
  ChatParticipantType.Applications,
  ChatParticipantType.Pipelines,
  ChatParticipantType.Toolkits,
  'mcp',
];

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

export interface ParticipantsProps {
  /** The participants array, owned by the consumer. */
  readonly participants: TransformedParticipant[];
  /** When true, show the collapsed (icon-only) row instead of sections. */
  readonly collapsed?: boolean;
  /** Callback to toggle collapsed state. */
  readonly onCollapsed?: () => void;
  /** When truthy, all editing operations are disabled. */
  readonly disabledEdit?: boolean;
  /** When truthy, the "add participant" affordance is disabled. */
  readonly disabledAdd?: boolean;
  /** Currently active participant id (used for highlighting the LLM). */
  readonly activeParticipantId?: string;
  /** Called when a participant is selected as the active LLM participant. */
  readonly onSelectParticipant?: (participant: TransformedParticipant) => void;
  /** Called to remove a participant from the chat. */
  readonly onDeleteParticipant?: (participant: TransformedParticipant) => void;
  /** Called to edit participant settings. */
  readonly onEditParticipant?: (participant: TransformedParticipant) => void;
  /** Called when a participant's settings are updated. */
  readonly onUpdateParticipant?: (participant: TransformedParticipant) => void;
  /** The toolkit currently being edited (controls which edit button is highlighted). */
  readonly editingToolkit?: string;
  /**
   * Optional slot to resolve toolkit/MCP icons. Falls back to a generic icon.
   * @see useParticipantEntityIcon
   */
  readonly resolveToolkitIcon?: Parameters<typeof useParticipantEntityIcon>[0]['resolveToolkitIcon'];
  /**
   * When true, this unit assumes MCP toolkits are visible and should not
   * filter them out. Set to `false` by default so MCP toolkits are grouped
   * separately; the consumer may override this via a context or prop.
   */
  readonly isMcpVisible?: boolean;
  /**
   * Slot for rendering the context-budget widget beneath the participants.
   * Receives `{ conversationId, contextStrategy, setActiveConversation,
   * conversationInstructions, persona }` — matching `features/pipelines/ui/
   * ChatPanel.tsx`'s `renderContextBudget` contract.
   *
   * This slot is the mechanism for rendering `@/[fsd]/widgets/context-budget`
   * without importing the `widgets/` layer (no-upward-from-features).
   */
  readonly renderContextBudget?: (props: {
    conversationId: string | number | undefined;
    contextStrategy?: Record<string, unknown>;
    setActiveConversation?: (update: unknown) => void;
    conversationInstructions?: string;
    persona?: unknown;
  }) => ReactNode;
  /**
   * Maximum number of user participants to show in the collapsed-row header
   * before adding a count indicator. Defaults to `5`.
   */
  readonly maxVisibleUsers?: number;
}

/**
 * Main participants list component. Groups participants by type into
 * `ParticipantSection` rows and renders a header with title and collapse
 * controls.
 *
 * The component is fully memoized via `React.memo` — re-renders only when
 * the reference to `props.participants` or any handler callback changes.
 *
 * @see ParticipantsWrapper for the provider wrapper
 * @see ParticipantSection for section-level rendering
 */
export const Participants = memo(
  ({
    participants,
    collapsed = false,
    onCollapsed,
    disabledEdit,
    disabledAdd,
    activeParticipantId,
    onSelectParticipant,
    onDeleteParticipant,
    onEditParticipant,
    onUpdateParticipant,
    editingToolkit,
    resolveToolkitIcon,
    isMcpVisible = false,
    renderContextBudget,
    maxVisibleUsers = 5,
  }: ParticipantsProps) => {
    const showTitle = !collapsed;
    const collapseIcon = collapsed
      ? KeyboardDoubleArrowLeftIcon
      : KeyboardDoubleArrowRightIcon;

    // -----------------------------------------------------------------------
    // Group participants by type
    // -----------------------------------------------------------------------

    const groupedByType = useMemo(() => {
      const groups: Record<string, TransformedParticipant[]> = {};

      for (const p of participants) {
        const entityName = p.entity_name as ChatParticipantType;
        const entitySettings = (p.entity_settings ?? {}) as Record<string, unknown>;
        const meta = (p.meta ?? {}) as Record<string, unknown>;

        let key: string = entityName;

        // Pipelines are a subtype of applications (agent_type = "pipeline")
        if (
          entityName === ChatParticipantType.Applications &&
          entitySettings.agent_type === ChatParticipantType.Pipelines
        ) {
          key = ChatParticipantType.Pipelines;
        }

        // MCP toolkits are a subtype of toolkits (toolkit_type matches "mcp")
        if (
          entityName === ChatParticipantType.Toolkits &&
          (isMcpToolkitType(entitySettings.toolkit_type as string | undefined) ||
            meta.mcp === true)
        ) {
          key = 'mcp';
        }

        // Filter out MCP toolkits when MCP visibility is off
        if (key === 'mcp' && !isMcpVisible) continue;

        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
      }

      return groups;
    }, [participants, isMcpVisible]);

    // -----------------------------------------------------------------------
    // Users section — extract and limit
    // -----------------------------------------------------------------------

    const userParticipants = useMemo(
      () =>
        groupedByType[ChatParticipantType.Users]
          ?.filter(isParticipantStillActive)
          .sort((a, b) => {
            const aId = Number(a.entity_meta?.id ?? 0);
            const bId = Number(b.entity_meta?.id ?? 0);
            return aId - bId;
          }) ?? [],
      [groupedByType],
    );

    const usersToDisplay = useMemo(
      () => userParticipants.slice(0, maxVisibleUsers),
      [userParticipants, maxVisibleUsers],
    );

    const visibleCount = userParticipants.length;
    const hasOverflow = visibleCount > maxVisibleUsers;

    // -----------------------------------------------------------------------
    // Build ordered sections for rendering
    // -----------------------------------------------------------------------

    const sections = useMemo(() => {
      const result: Array<{ key: string; type: string; participants: TransformedParticipant[] }> = [];

      for (const type of ENTITY_ORDER) {
        const key = typeof type === 'string' ? type : String(type);
        const group = groupedByType[key];
        if (!group || group.length === 0) continue;

        // "mcp" key maps to the 'mcp' constant
        const entityType =
          key === 'mcp'
            ? 'MCP'
            : type === ChatParticipantType.Applications
              ? 'Agent'
              : type === ChatParticipantType.Pipelines
                ? 'Pipeline'
                : type === ChatParticipantType.Toolkits
                  ? 'Toolkit'
                  : type === ChatParticipantType.Users
                    ? 'Users'
                    : String(type);

        result.push({ key, type, participants: group, entityType });
      }

      return result;
    }, [groupedByType]);

    // -----------------------------------------------------------------------
    // Handlers — prevent re-creation
    // -----------------------------------------------------------------------

    const handleSelectParticipant = useCallback(
      (p: TransformedParticipant) => {
        onSelectParticipant?.(p);
      },
      [onSelectParticipant],
    );

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

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
                Participants
              </Typography>
            )}
            {onCollapsed && (
              <IconButton
                sx={styles.collapseButton}
                size="small"
                onClick={onCollapsed}
                aria-label={collapsed ? 'Expand participants' : 'Collapse participants'}
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
                      participant={p}
                      isActive={activeParticipantId === chatParticipantUniqueId(p)}
                      onClickItem={handleSelectParticipant}
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
                participants={group}
                collapsed={collapsed}
                activeParticipantId={activeParticipantId}
                onSelectParticipant={handleSelectParticipant}
                onDeleteParticipant={onDeleteParticipant}
                onEditParticipant={onEditParticipant}
                onUpdateParticipant={onUpdateParticipant}
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
                No participants
              </Typography>
            )}
          </Box>
        </Box>

        {/* Context budget slot */}
        {renderContextBudget && (
          <Box sx={styles.contextBudgetWrapper}>
            {renderContextBudget({
              conversationId: undefined,
              contextStrategy: undefined,
              setActiveConversation: undefined,
              conversationInstructions: undefined,
              persona: undefined,
            })}
          </Box>
        )}
      </Box>
    );
  },
);

Participants.displayName = 'Participants';
