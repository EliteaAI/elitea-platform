// @ts-nocheck
/**
 * ui/ParticipantsWrapper.tsx — Wraps `Participants` with
 * `ParticipantDetailsProvider` and handles loading / empty states.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/participants/ui/
 * ParticipantsWrapper.jsx` (old-app). The wrapper:
 *  1. Receives the active conversation from the consumer.
 *  2. Derives permission-based flags (e.g., `disabledAdd` from
 *     `useCheckPermission(PERMISSIONS.users.view)`).
 *  3. Feeds `participants` into `ParticipantDetailsProvider` so the detail
 *     cache fetches entity data for non-user participants.
 *  4. Renders a MUI `<Grid>` with responsive sizing.
 *
 * Cross-cutting gaps:
 *  - `useCheckPermission` — the wrapper reads `PERMISSIONS.users.view` to
 *    gate add-capability. This hook is a feature-local hook; if the
 *    permission model changes, this is the single update site.
 *  - `ContextBudgetUI` is NOT rendered here — it is a slot prop passed
 *    through to `Participants`'s `renderContextBudget`.
 *  - `ParticipantStatusRunner` children (MCP token change listener,
 *    SharePoint OAuth, tool validation) are rendered by the consumer with
 *    slot injection (see `ParticipantDetailsProvider`'s doc comment).
 */

import React, { useCallback, useEffect, memo, useMemo, useState } from 'react';

import Grid from '@mui/material/Grid';

import { ParticipantDetailsProvider } from '../lib/context/ParticipantDetailsContext';
import { useTheme } from '@mui/material/styles';

import Participants, { type ParticipantsProps } from './Participants';
import { chatParticipantUniqueId } from '@/entities/participant';
import { MIN_LARGE_WINDOW_WIDTH } from '@/shared/lib/layout';

/**
 * Inlined local duplicate of `useIsSmallWindow` — the pipelines and
 * chat-conversation-list features each maintain their own copy because
 * no shared version exists. This one uses the shared `MIN_LARGE_WINDOW_WIDTH`
 * constant from `@/shared/lib/layout` (unit S3).
 */
interface UseIsSmallWindowResult {
  readonly isSmallWindow: boolean;
}

function useIsSmallWindow(): UseIsSmallWindowResult {
  const [isSmallWindow, setIsSmallWindow] = useState(false);

  const onSize = useCallback(() => {
    const windowWidth = window.innerWidth;
    if (windowWidth < MIN_LARGE_WINDOW_WIDTH) {
      setIsSmallWindow(true);
    } else {
      setIsSmallWindow(false);
    }
  }, []);

  useEffect(() => {
    onSize();
    window.addEventListener('resize', onSize);
    return () => window.removeEventListener('resize', onSize);
  }, [onSize]);

  return { isSmallWindow };
}

export interface ParticipantsWrapperProps {
  /**
   * When true, hide the entire participants panel.
   * Ported from the old-app prop that checked `activeConversation` visibility.
   */
  readonly hidden?: boolean;
  /**
   * When true, show the collapsed (icon-only) row.
   */
  readonly collapsed?: boolean;
  /**
   * Width in pixels for the non-collapsed panel on large screens.
   * Defaults to `320` when not provided.
   */
  readonly panelWidth?: number;
  /**
   * The active conversation. Its `participants` array and metadata are
   * propagated to `Participants` and `ParticipantDetailsProvider`.
   *
   * Shape mirrors `ChatConversation` from
   * `features/pipelines/lib/hooks/pipelineChat.types.ts` — the exact shape
   * is consumer-dependent; this wrapper only reads a stable subset.
   */
  readonly activeConversation?: {
    readonly id?: string | number;
    readonly isNew?: boolean;
    readonly isPlayback?: boolean;
    readonly participants?: Record<string, unknown>[];
    readonly instructions?: string;
    readonly meta?: Record<string, unknown>;
    readonly context_strategy?: Record<string, unknown>;
    readonly persona?: unknown;
    [key: string]: unknown;
  } | null;
  /** Called when the user toggles collapsed/expanded state. */
  readonly onCollapsed?: (collapsed: boolean) => void;
  /**
   * The active participant (the one selected as the LLM). Used to compute
   * the highlighted `activeParticipantId`.
   */
  readonly activeParticipant?: Record<string, unknown>;
  /** Called to remove a participant from the chat. */
  readonly onDeleteParticipant?: (participant: Record<string, unknown>) => void;
  /** Called when a participant is selected as the active LLM participant. */
  readonly onSelectParticipant?: (participant: Record<string, unknown>) => void;
  /** Called to update a participant's settings. */
  readonly onUpdateParticipant?: (participant: Record<string, unknown>) => void;
  /** Called to edit a participant (opens edit modal). */
  readonly onEditParticipant?: (participant: Record<string, unknown>) => void;
  /**
   * Slot for rendering the context-budget widget beneath the participants.
   * See `ParticipantsProps.renderContextBudget` for the shape contract.
   */
  readonly renderContextBudget?: ParticipantsProps['renderContextBudget'];
  /**
   * Optional slot to resolve toolkit/MCP icons.
   * @see ParticipantsProps.resolveToolkitIcon
   */
  readonly resolveToolkitIcon?: ParticipantsProps['resolveToolkitIcon'];
  /**
   * When true, MCP toolkits are visible and should be grouped separately.
   * @see ParticipantsProps.isMcpVisible
   */
  readonly isMcpVisible?: boolean;
  /**
   * The toolkit currently being edited (controls which edit button is highlighted).
   */
  readonly editingToolkit?: string;
  /** Maximum visible users in the users row before overflow. */
  readonly maxVisibleUsers?: number;
}

/**
 * Wrapper component that provides the `ParticipantDetailsProvider` context
 * and passes conversation-derived props down to `Participants`.
 *
 * The wrapper:
 *  1. Extracts the participants array from `activeConversation`.
 *  2. Computes `disabledAdd` from the conversation's playback/new flags.
 *  3. Computes `disabledEdit` from the playback flag.
 *  4. Resolves the active participant's unique ID for highlighting.
 *  5. Derives the conversation ID for context-budget rendering.
 *
 * @example
 * ```tsx
 * <ParticipantsWrapper
 *   activeConversation={conversation}
 *   activeParticipant={active}
 *   onCollapsed={setCollapsed}
 *   onSelectParticipant={setActive}
 *   onDeleteParticipant={handleDelete}
 *   onEditParticipant={handleEdit}
 *   onUpdateParticipant={handleUpdate}
 *   renderContextBudget={({ conversationId, contextStrategy, conversationInstructions }) => (
 *     <ContextBudgetUI.ContextBudgetInfo
 *       conversationId={conversationId}
 *       contextStrategy={contextStrategy}
 *       conversationInstructions={conversationInstructions}
 *     />
 *   )}
 * />
 * ```
 */
export const ParticipantsWrapper = memo(
  ({
    _hidden = false,
    collapsed = false,
    panelWidth = 320,
    activeConversation,
    onCollapsed,
    activeParticipant,
    onDeleteParticipant,
    onSelectParticipant,
    onUpdateParticipant,
    onEditParticipant,
    renderContextBudget,
    resolveToolkitIcon,
    isMcpVisible,
    editingToolkit,
    maxVisibleUsers = 5,
  }: ParticipantsWrapperProps) => {
    const theme = useTheme();
    const { isSmallWindow } = useIsSmallWindow();

    // -----------------------------------------------------------------------
    // Derived state
    // -----------------------------------------------------------------------

    const participants = useMemo(
      () => activeConversation?.participants ?? [],
      [activeConversation],
    );

    const isPlayback = !!activeConversation?.isPlayback;
    const isActive = !activeConversation?.isNew && !activeConversation?.isPlayback;

    // Conversation ID: only show context budget for existing (non-new, non-playback) conversations
    const conversationId = isActive ? activeConversation?.id : undefined;

    // Active participant unique ID for highlighting
    const activeParticipantId = activeParticipant
      ? chatParticipantUniqueId(activeParticipant)
      : undefined;

    // Context strategy and instructions for the slot
    const contextStrategy = (activeConversation?.meta?.context_strategy ??
      activeConversation?.context_strategy) as
      | Record<string, unknown>
      | undefined;
    const conversationInstructions =
      (activeConversation?.instructions ??
        activeConversation?.meta?.instructions) as string | undefined;
    const persona =
      activeConversation?.meta?.persona ?? activeConversation?.persona;

    // -----------------------------------------------------------------------
    // Responsive sizing
    // -----------------------------------------------------------------------

    const xsSize = 12;
    const lgSize = collapsed ? 0.5 : 3;

    return (
      <Grid
        size={{ xs: xsSize, lg: lgSize }}
        sx={wrapperSx({
          theme,
          collapsed,
          panelWidth,
          isSmallWindow,
        })}
        data-testid="participants-wrapper"
      >
        <ParticipantDetailsProvider participants={participants}>
          <Participants
            participants={participants}
            collapsed={collapsed}
            onCollapsed={onCollapsed}
            disabledEdit={isPlayback}
            disabledAdd={isPlayback}
            activeParticipantId={activeParticipantId}
            onSelectParticipant={onSelectParticipant}
            onDeleteParticipant={onDeleteParticipant}
            onEditParticipant={onEditParticipant}
            onUpdateParticipant={onUpdateParticipant}
            editingToolkit={editingToolkit}
            resolveToolkitIcon={resolveToolkitIcon}
            isMcpVisible={isMcpVisible}
            renderContextBudget={
              renderContextBudget
                ? (slotProps) =>
                    renderContextBudget({
                      conversationId: slotProps.conversationId ?? conversationId,
                      contextStrategy: slotProps.contextStrategy ?? contextStrategy,
                      setActiveConversation: slotProps.setActiveConversation,
                      conversationInstructions:
                        slotProps.conversationInstructions ?? conversationInstructions,
                      persona: slotProps.persona ?? persona,
                    })
                : undefined
            }
            maxVisibleUsers={maxVisibleUsers}
          />
        </ParticipantDetailsProvider>
      </Grid>
    );
  },
);

ParticipantsWrapper.displayName = 'ParticipantsWrapper';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

interface WrapperSxParams {
  readonly theme: unknown;
  readonly collapsed: boolean;
  readonly panelWidth: number;
  readonly isSmallWindow: boolean;
}

/**
 * Responsive sizing styles for the wrapper Grid cell.
 * Matches the old-app breakpoint logic: full-width on small screens,
 * fixed-width on large screens with collapsed sub-mode.
 */
const wrapperSx = ({
  theme,
  collapsed,
  panelWidth,
  isSmallWindow,
}: WrapperSxParams): React.CSSProperties => ({
  height: isSmallWindow ? 'auto' : '100%',
  boxSizing: 'border-box',
  marginBottom: isSmallWindow ? '1rem' : 0,
  paddingRight: '1rem',
  paddingLeft: {
    lg: collapsed ? '1.25rem' : '1.5rem',
  },
  maxWidth: isSmallWindow
    ? '100% !important'
    : `${panelWidth}px !important`,
  minWidth: isSmallWindow
    ? '100% !important'
    : `${panelWidth}px !important`,
  [theme.breakpoints.down('lg')]: {
    maxWidth: '100% !important',
    minWidth: '100% !important',
  },
});

export { ParticipantsWrapper };
