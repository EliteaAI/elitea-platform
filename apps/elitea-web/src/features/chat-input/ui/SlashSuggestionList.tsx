/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/chat/ui/slash-suggestion-list/
 * SlashSuggestionList.jsx` — the "/" toolkit/tool suggestion popup.
 * Composes `ToolkitValidator` (one per participant toolkit),
 * `ToolkitMentionList` (this slice's own local replacement for the
 * baseline's page-layer `NewParticipantList` import — see that file's own
 * doc comment) for the 'toolkit' phase, and `shared/ui/MentionToolList`
 * (this app's already-ported, byte-for-byte equivalent of the baseline's
 * `ToolItem.jsx`/`ToolList.jsx` — see this file's header for why it is
 * reused rather than re-derived) for the 'tool' phase.
 *
 * **`shared/ui/MentionToolList`/`MentionToolItem` reused, not
 * re-derived — a deliberate judgment call.** `entities/toolkit`... no —
 * `shared/ui/MentionToolList.tsx`'s own doc comment says it was "Ported
 * from `apps/elitea-ui/src/[fsd]/shared/ui/mention/MentionToolList.jsx`" —
 * a SEPARATE baseline file, confirmed (by reading both) to be a
 * near-byte-for-byte duplicate of THIS unit's own baseline
 * `ToolItem.jsx`/`ToolList.jsx`, with zero consumers anywhere in the old
 * app (grep-verified). This unit's own task brief explicitly anticipates
 * exactly this kind of duplicate-in-`shared/lib` situation for
 * `parseMentionRanges` ("a live, in-repo example of this exact judgment
 * call being acceptable") — the SAME reasoning applies one layer up, in
 * `shared/ui`: `MentionToolList`/`MentionToolItem` (unit S1-G) are that
 * baseline duplicate, already ported, already includes an accessibility
 * fix (`ButtonBase` instead of a bare `onClick` `Box`) this port would
 * otherwise have to redo, and `shared/ui` is a LEGAL downward import for
 * `features/chat-input` (unlike `features/agents`). Building a second,
 * feature-local `ToolItem`/`ToolList` pair here would be pure duplication
 * of a component this app already has — so this unit becomes the first
 * real caller of `shared/ui/MentionToolList` instead.
 *
 * **`useToolkitDetailsQuery` injected, not called internally — a real,
 * disclosed backend gap.** The baseline drives the 'tool'-phase list from
 * `useToolkitsDetailsQuery({projectId, toolkitId})` (`GET /elitea_core/
 * tool/prompt_lib/{projectId}/{toolkitId}`). Grepping the entire generated
 * client (`shared/api/generated/toolkits/toolkits.ts`) confirms only
 * `useListToolkits`/`useListToolkitInstances` exist — no single-toolkit
 * detail endpoint at all (same real gap `entities/toolkit`'s own
 * `useValidateToolkit.ts` documents for validation). Also confirmed
 * against the baseline itself: NEITHER `useSlashMention.hooks.js`'s
 * `participantToolkits` mapping NOR `SlashSuggestionList.jsx`'s
 * `onSelectToolkit` callback ever populates a toolkit's `settings` field —
 * the 'tool'-phase list has NO other data source to fall back to. The
 * injected `useToolkitDetailsQuery` returns already-normalised `{name,
 * description}` tool rows (not the baseline's raw `toolkitDetails.settings
 * .available_mcp_tools`/`selected_tools`) so the MCP-vs-non-MCP shape
 * branching lives in the wiring layer, alongside the real fetch, matching
 * `ApplicationValidator`'s `useValidate`/`useValidateToolkit`'s
 * `useValidateToolkitQuery` injection precedent.
 */
import type { ReactNode } from 'react';
import { useEffect, useMemo } from 'react';

import { toolkitValidation } from '@/entities/toolkit';
import { t } from '@/shared/i18n';
import { MentionToolList } from '@/shared/ui/MentionToolList';

import type { SlashPhase, SlashToolkitRef } from '../lib/hooks/useSlashCommandHandler.types';
import type { SlashParticipantToolkit } from '../lib/hooks/useSlashMention';

import { ToolkitMentionList } from './ToolkitMentionList';
import { ToolkitValidator } from './ToolkitValidator';
import type { UseValidateToolkitQuery } from './ToolkitValidator';

/** `mcp.helpers.js:7-14`'s `isMcpToolkitType`, duplicated a 4th time in this slice — see `../lib/hooks/useSlashMention.ts`'s header for why no shared home exists. */
function isMcpToolkitType(type: string): boolean {
  return type === 'mcp' || type.startsWith('mcp_');
}

interface ToolkitDetailsArgs {
  readonly projectId: string | undefined;
  readonly toolkitId: string | undefined;
  readonly skip: boolean;
}

interface ToolkitDetailsTool {
  readonly name: string;
  /** No explicit `| undefined` (unlike this file's other optional fields) — deliberately matches `shared/ui/MentionToolList`'s `MentionTool.description?: string` exactly, since `filteredTools` below is passed straight through to it under `exactOptionalPropertyTypes`. */
  readonly description?: string;
}

interface ToolkitDetailsResult {
  readonly tools: readonly ToolkitDetailsTool[];
  readonly isFetching: boolean;
}

/** Injected rather than called internally — see the module doc comment. */
export type UseToolkitDetailsQuery = (args: ToolkitDetailsArgs) => ToolkitDetailsResult;

export interface SlashSuggestionListProps {
  readonly phase: SlashPhase;
  readonly toolkitQuery: string;
  readonly toolQuery: string;
  readonly selectedToolkit: SlashToolkitRef | null;
  readonly isQueryFinal: boolean;
  readonly onSelectToolkit: (toolkit: SlashParticipantToolkit) => void;
  /** `null` both commits "the whole toolkit, no specific tool" AND (via `MentionToolList`'s own `ClickAwayListener`) signals "close without picking a tool" — same one-callback convention `shared/ui/MentionToolList`'s own doc comment documents. */
  readonly onSelectTool: (toolName: string | null) => void;
  readonly onClose: () => void;
  readonly participantToolkits: readonly SlashParticipantToolkit[];
  readonly isMcpVisible: boolean;
  readonly activeIndex: number;
  readonly setActiveIndex: (index: number) => void;
  readonly itemCountRef: { current: number };
  readonly onConfirmActiveRef: { current: ((index: number) => void) | null };
  /** Injected rather than called internally — see `entities/toolkit`'s own `useValidateToolkit` doc comment for the real backend gap this forwards to every rendered `ToolkitValidator`. */
  readonly useValidateToolkitQuery: UseValidateToolkitQuery;
  /** Injected rather than called internally — see the module doc comment. */
  readonly useToolkitDetailsQuery: UseToolkitDetailsQuery;
}

/**
 * The phase-dependent render output — extracted from `SlashSuggestionList`
 * itself purely to keep that component's own `complexity` under this
 * codebase's budget (12); every hook (`useMemo`/`useEffect`) stays in the
 * component body above, this only assembles JSX from already-computed
 * values.
 */
function renderPhaseBody(params: {
  readonly phase: SlashPhase;
  readonly validators: ReactNode;
  readonly filteredParticipants: readonly SlashParticipantToolkit[];
  readonly filteredTools: readonly ToolkitDetailsTool[];
  readonly isFetchingTools: boolean;
  readonly toolQuery: string;
  readonly selectedToolkitName: string;
  readonly toolkitDropdownTitle: string;
  readonly activeIndex: number;
  readonly onSelectToolkit: (toolkit: SlashParticipantToolkit) => void;
  readonly onSelectTool: (toolName: string | null) => void;
  readonly onClose: () => void;
}): ReactNode {
  if (params.phase === 'idle') return null;

  if (params.phase === 'toolkit') {
    return (
      <>
        {params.validators}
        <ToolkitMentionList
          toolkits={params.filteredParticipants}
          onSelectToolkit={params.onSelectToolkit}
          onClose={params.onClose}
          title={params.toolkitDropdownTitle}
          activeIndex={params.activeIndex}
        />
      </>
    );
  }

  // phase === 'tool' — hide the list entirely when the filter matches nothing (but not while loading)
  if (!params.isFetchingTools && params.toolQuery && params.filteredTools.length === 0) return null;

  return (
    <MentionToolList
      tools={[...params.filteredTools]}
      toolkitName={params.selectedToolkitName}
      onSelectTool={params.onSelectTool}
      highlightedIndex={params.activeIndex}
    />
  );
}

export function SlashSuggestionList(props: SlashSuggestionListProps): ReactNode {
  const {
    phase,
    toolkitQuery,
    toolQuery,
    selectedToolkit,
    isQueryFinal,
    onSelectToolkit,
    onSelectTool,
    onClose,
    participantToolkits,
    isMcpVisible,
    activeIndex,
    setActiveIndex,
    itemCountRef,
    onConfirmActiveRef,
    useValidateToolkitQuery,
    useToolkitDetailsQuery,
  } = props;

  const infoByKey = toolkitValidation.useToolkitValidationStore((state) => state.infoByKey);

  // Only show toolkits that are added as conversation participants (AC1)
  // and are properly configured (AC2). Name filtering is done client-side
  // for instant response (no debounce lag).
  const filteredParticipants = useMemo(() => {
    if (!participantToolkits.length) return [];
    return participantToolkits.filter((p) => {
      if (!isMcpVisible && isMcpToolkitType(p.type)) return false;
      const key = toolkitValidation.buildToolkitValidationKey(p.projectId, p.id);
      const validationErrors = infoByKey[key];
      if (validationErrors && validationErrors.length > 0) return false;
      if (toolkitQuery && !p.name.toLowerCase().includes(toolkitQuery.toLowerCase())) return false;
      return true;
    });
  }, [participantToolkits, infoByKey, toolkitQuery, isMcpVisible]);

  const toolkitDetails = useToolkitDetailsQuery({
    projectId: selectedToolkit?.projectId,
    toolkitId: selectedToolkit?.id,
    skip: phase !== 'tool' || !selectedToolkit,
  });

  const filteredTools = useMemo(
    () => toolkitDetails.tools.filter((tool) => !toolQuery || tool.name.toLowerCase().includes(toolQuery.toLowerCase())),
    [toolkitDetails.tools, toolQuery],
  );

  useEffect(() => {
    if (phase !== 'toolkit' || !isQueryFinal) return;

    const match = filteredParticipants.find((p) => p.name.toLowerCase().startsWith(toolkitQuery.toLowerCase()));
    if (match && (match.projectId !== selectedToolkit?.projectId || match.id !== selectedToolkit?.id)) {
      onSelectToolkit(match);
    } else {
      onClose();
    }
    // oxlint-disable-next-line react/exhaustive-deps -- mirrors the baseline's own deliberately-scoped dependency list (`SlashSuggestionList.jsx`'s own `[phase, isQueryFinal, toolkitQuery, filteredParticipants]`), not every closed-over value.
  }, [phase, isQueryFinal, toolkitQuery, filteredParticipants]);

  // Keep itemCountRef in sync and reset active index whenever the visible list changes.
  const currentListLength = phase === 'toolkit' ? filteredParticipants.length : filteredTools.length;
  useEffect(() => {
    itemCountRef.current = currentListLength;
    setActiveIndex(0);
    // oxlint-disable-next-line react/exhaustive-deps -- mirrors the baseline's own `[currentListLength]`-only dependency list.
  }, [currentListLength]);

  // Register the confirm callback for the current phase so Enter can trigger selection.
  useEffect(() => {
    if (phase === 'toolkit') {
      onConfirmActiveRef.current = (idx) => {
        const participant = filteredParticipants[idx];
        if (participant) onSelectToolkit(participant);
      };
    } else if (phase === 'tool') {
      onConfirmActiveRef.current = (idx) => {
        const tool = filteredTools[idx];
        if (tool) onSelectTool(tool.name);
      };
    } else {
      onConfirmActiveRef.current = null;
    }
    // oxlint-disable-next-line react/exhaustive-deps -- mirrors the baseline's own `[phase, filteredParticipants, filteredTools]`-only dependency list.
  }, [phase, filteredParticipants, filteredTools]);

  // Render one validator per participant toolkit. Each mounts when the slash menu
  // opens and fires the validation API only when no data exists yet in the store.
  const validators = participantToolkits.map((toolkit) => (
    <ToolkitValidator
      key={`${toolkit.projectId}_${toolkit.id}`}
      toolkitId={toolkit.id}
      projectId={toolkit.projectId}
      useValidateToolkitQuery={useValidateToolkitQuery}
    />
  ));

  return renderPhaseBody({
    phase,
    validators,
    filteredParticipants,
    filteredTools,
    isFetchingTools: toolkitDetails.isFetching,
    toolQuery,
    selectedToolkitName: selectedToolkit?.name ?? '',
    toolkitDropdownTitle: isMcpVisible
      ? t('chatInput.slashSuggestionList.mentionToolkitOrMcp', 'Mention Toolkit or MCP')
      : t('chatInput.slashSuggestionList.mentionToolkit', 'Mention Toolkit'),
    activeIndex,
    onSelectToolkit,
    onSelectTool,
    onClose,
  });
}
