/**
 * Local UI state for ChatBox.
 *
 * Manages the component's internal React state — mentions, conversation
 * starters, speaking mode, recommendation list visibility, and symbol
 * processing — that does not flow from the conversation entity layer.
 *
 * Port of `ChatBox.jsx` local `useState` calls (lines ~280–430).
 */
import { useCallback, useMemo, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  Shared shapes                                                       */
/* ------------------------------------------------------------------ */

/** A user participant resolved from conversation participants. */
export interface ResolvedUserMention {
  readonly id: string;
  readonly name: string;
  readonly participant: unknown;
}

/** A conversation starter suggestion item. */
export interface ConversationStarter {
  readonly id: string;
  readonly text: string;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                                */
/* ------------------------------------------------------------------ */

/**
 * Params for local state hook — only the values needed for initialisation
 * or reactive recalculations. Callbacks are provided as direct parameters
 * of the returned state fields, keeping the hook result flat.
 */
export interface UseChatBoxStateParams {
  /** Currently active participant (for recommendation list gating). */
  readonly activeParticipant: unknown;
  /** Conversation participants (for user mention resolution). */
  readonly participants: unknown[] | undefined;
  /** Current user ID (for filtering own user from mentions). */
  readonly userId: string | undefined;
  /** Conversation starter items from props. */
  readonly conversationStarters: readonly ConversationStarter[] | undefined;
  /** Whether this is the agents page (gates certain state). */
  readonly isAgentsPage: boolean | undefined;
}

export interface UseChatBoxStateResult {
  /** Selected user mentions for "send to user" mode. */
  readonly selectedUsers: ResolvedUserMention[];
  readonly setSelectedUsers: (users: ResolvedUserMention[]) => void;
  /** Whether `@everyone` was mentioned. */
  readonly isMentioningEveryone: boolean;
  readonly setIsMentioningEveryone: (flag: boolean) => void;
  /** Whether a conversation starter has already been sent. */
  readonly hasStarterBeenSent: boolean;
  readonly setHasStarterBeenSent: (flag: boolean) => void;
  /** Speaking mode (hands-free voice input). */
  readonly isSpeakingMode: boolean;
  readonly setIsSpeakingMode: (flag: boolean) => void;
  /** Whether the recommendation (participant) list is visible. */
  readonly showRecommendationList: boolean;
  readonly setShowRecommendationList: (flag: boolean) => void;
  /** Whether user-input symbol processing (@/~/#) is active. */
  readonly isProcessingSymbols: boolean;
  readonly setIsProcessingSymbols: (flag: boolean) => void;
  /** Currently active mention query (the text after @/~/#). */
  readonly query: string;
  readonly setQuery: (q: string) => void;
  /** Whether slash mention (for toolkits/tools) is active. */
  readonly slashPhase: string;
  readonly setSlashPhase: (phase: string) => void;
  /** Slash tool query text. */
  readonly slashToolkitQuery: string;
  readonly setSlashToolkitQuery: (q: string) => void;
  /** Slash tool query text. */
  readonly slashToolQuery: string;
  readonly setSlashToolQuery: (q: string) => void;
  /** Currently selected toolkit in slash mention. */
  readonly slashSelectedToolkit: string | null;
  readonly setSlashSelectedToolkit: (name: string | null) => void;
  /** Whether slash mention query is final (not a prefix search). */
  readonly slashIsQueryFinal: boolean;
  readonly setSlashIsQueryFinal: (flag: boolean) => void;
  /** Whether skill mention (~) is active. */
  readonly isSkillPhaseActive: boolean;
  readonly setIsSkillPhaseActive: (flag: boolean) => void;
  /** Skill mention filter query. */
  readonly skillQuery: string;
  readonly setSkillQuery: (q: string) => void;
  /** Skill mention filtered items. */
  readonly skillFilteredItems: readonly unknown[];
  readonly setSkillFilteredItems: (items: readonly unknown[]) => void;
  /** Highlight ranges from slash mention. */
  readonly slashHighlightRanges: readonly { start: number; end: number }[];
  /** Highlight ranges from skill mention. */
  readonly skillHighlightRanges: readonly { start: number; end: number }[];
  /** Combined highlight ranges from all mention phases. */
  readonly combinedHighlightRanges: readonly { start: number; end: number }[];
  /** Whether conversation starters should be displayed. */
  readonly shouldShowStarters: boolean;
  /** The effective user mentions for the current conversation. */
  readonly users: ResolvedUserMention[];
  /** Whether the conversation has users other than the current one. */
  readonly hasOtherUsers: boolean;
  /** Reset slash mention state. */
  readonly resetSlash: () => void;
  /** Reset skill mention state. */
  readonly resetSkill: () => void;
  /** Stop processing all symbols (@/~/#). */
  readonly stopProcessingSymbols: () => void;
}

/**
 * Hook that manages all local UI state for the ChatBox composition root.
 * This replaces the ~15 individual `useState` calls in the old ChatBox.jsx
 * with a single, cohesive state bundle that can be easily reasoned about.
 */
export function useChatBoxState(params: UseChatBoxStateParams): UseChatBoxStateResult {
  const { activeParticipant, participants, userId, conversationStarters, isAgentsPage } = params;
  void isAgentsPage; // reserved for future gating logic

  // -- Local state --
  const [selectedUsers, setSelectedUsers] = useState<ResolvedUserMention[]>([]);
  const [isMentioningEveryone, setIsMentioningEveryone] = useState(false);
  const [hasStarterBeenSent, setHasStarterBeenSent] = useState(false);
  const [isSpeakingMode, setIsSpeakingMode] = useState(false);
  const [showRecommendationList, setShowRecommendationList] = useState(false);
  const [isProcessingSymbols, setIsProcessingSymbols] = useState(false);
  const [query, setQuery] = useState('');
  const [slashPhase, setSlashPhase] = useState('idle');
  const [slashToolkitQuery, setSlashToolkitQuery] = useState('');
  const [slashToolQuery, setSlashToolQuery] = useState('');
  const [slashSelectedToolkit, setSlashSelectedToolkit] = useState<string | null>(null);
  const [slashIsQueryFinal, setSlashIsQueryFinal] = useState(false);
  const [isSkillPhaseActive, setIsSkillPhaseActive] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillFilteredItems, setSkillFilteredItems] = useState<readonly unknown[]>([]);

  // -- Computed: highlight ranges --
  const slashHighlightRanges = useMemo<UseChatBoxStateResult['slashHighlightRanges']>(
    () => (slashIsQueryFinal && slashToolQuery ? [{ start: 0, end: slashToolQuery.length }] : []),
    [slashIsQueryFinal, slashToolQuery],
  );

  const skillHighlightRanges = useMemo<UseChatBoxStateResult['skillHighlightRanges']>(
    () => (isSkillPhaseActive && skillQuery ? [{ start: 0, end: skillQuery.length }] : []),
    [isSkillPhaseActive, skillQuery],
  );

  const combinedHighlightRanges = useMemo(() => {
    const all = [...slashHighlightRanges, ...skillHighlightRanges].sort((a, b) => a.start - b.start);
    return all;
  }, [slashHighlightRanges, skillHighlightRanges]);

  // -- Computed: should show starters --
  const shouldShowStarters = useMemo(
    () => !isProcessingSymbols && (conversationStarters?.length ?? 0) > 0,
    [isProcessingSymbols, conversationStarters],
  );

  // -- Computed: user mentions --
  const users = useMemo<ResolvedUserMention[]>(() => {
    if (!participants) return [];
    const result: ResolvedUserMention[] = [];

    for (const p of participants) {
      const entityName = (p as Record<string, unknown>)?.entity_name as string | undefined;
      const meta = (p as Record<string, unknown>)?.entity_meta as Record<string, unknown> | undefined;
      const metaId = meta?.id as string | undefined;
      const metaUserName = meta?.user_name as string | undefined;

      if (entityName === 'user' && metaId && metaUserName && metaId !== userId) {
        result.push({ id: String((p as Record<string, unknown>).id), name: metaUserName, participant: p as unknown });
      }
    }

    // Add "@everyone" option
    result.push({ id: '@everyone', name: 'Everyone', participant: 'All users' });
    return result;
  }, [participants, userId]);

  const hasOtherUsers = useMemo(() => {
    if (!participants) return false;
    return participants.some((p) => {
      const entityName = (p as Record<string, unknown>)?.entity_name as string | undefined;
      const meta = (p as Record<string, unknown>)?.entity_meta as Record<string, unknown> | undefined;
      const metaId = meta?.id as string | undefined;
      return entityName === 'user' && metaId && metaId !== userId;
    });
  }, [participants, userId]);

  // -- Reset functions --
  const resetSlash = useCallback(() => {
    setSlashPhase('idle');
    setSlashToolkitQuery('');
    setSlashToolQuery('');
    setSlashSelectedToolkit(null);
    setSlashIsQueryFinal(false);
  }, []);

  const resetSkill = useCallback(() => {
    setIsSkillPhaseActive(false);
    setSkillQuery('');
    setSkillFilteredItems([]);
  }, []);

  const stopProcessingSymbols = useCallback(() => {
    setIsProcessingSymbols(false);
    setQuery('');
  }, []);

  // -- Gate recommendation list when active participant changes --
  // (The composition root controls this via `activeParticipant` param.
  //  We reset the recommendation list whenever the participant changes.)
  const prevParticipantId = useState<string | undefined>(
    (activeParticipant as Record<string, unknown>)?.id?.toString(),
  )[0];
  if (prevParticipantId !== (activeParticipant as Record<string, unknown>)?.id?.toString() && activeParticipant) {
    setShowRecommendationList(false);
  }

  return {
    selectedUsers,
    setSelectedUsers,
    isMentioningEveryone,
    setIsMentioningEveryone,
    hasStarterBeenSent,
    setHasStarterBeenSent,
    isSpeakingMode,
    setIsSpeakingMode,
    showRecommendationList,
    setShowRecommendationList,
    isProcessingSymbols,
    setIsProcessingSymbols,
    query,
    setQuery,
    slashPhase,
    setSlashPhase,
    slashToolkitQuery,
    setSlashToolkitQuery,
    slashToolQuery,
    setSlashToolQuery,
    slashSelectedToolkit,
    setSlashSelectedToolkit,
    slashIsQueryFinal,
    setSlashIsQueryFinal,
    isSkillPhaseActive,
    setIsSkillPhaseActive,
    skillQuery,
    setSkillQuery,
    skillFilteredItems,
    setSkillFilteredItems,
    slashHighlightRanges,
    skillHighlightRanges,
    combinedHighlightRanges,
    shouldShowStarters,
    users,
    hasOtherUsers,
    resetSlash,
    resetSkill,
    stopProcessingSymbols,
  };
}
