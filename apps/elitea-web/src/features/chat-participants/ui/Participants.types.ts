// @ts-nocheck
/**
 * ui/Participants.types.ts — shared type definitions for the chat-participants
 * participants feature.
 *
 * Extracted from `Participants.tsx` to break the circular import between
 * `Participants.tsx` and `ParticipantsLayout.tsx`.
 */
import type { TransformedParticipant } from '../model/types';

/** Order in which participant types appear in the expanded list. */
export const ENTITY_ORDER: string[] = [
  'Users',
  'Applications',
  'Pipelines',
  'Toolkits',
  'mcp',
];

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
