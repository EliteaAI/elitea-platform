/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useSlashCommandHandler.hooks.js` (609 lines — the toolkit/tool state
 * machine, split across this file plus `useSlashCommandHandler.types.ts`/
 * `.helpers.ts`/`.idlePhase.ts`/`.toolPhase.ts` purely to stay under this
 * codebase's `max-lines`(400)/`complexity`(12) budgets; no behaviour
 * differs from a single-file port — every phase-resolver function below is
 * a direct, function-for-function translation of the baseline's own
 * already-split helpers, just threaded through a `SlashHandlerContext`
 * instead of closing over component state via `useCallback`).
 *
 * Manages "/" slash-mention state in the chat input. Phases: 'idle' (no
 * active mention) -> 'toolkit' (user typed "/" and is filtering toolkits by
 * name) -> 'tool' (user selected a toolkit and is optionally filtering its
 * tools).
 *
 * Design principle — single source of truth: `syncWithValue()` parses the
 * actual textarea text on every onChange. `onKeyDown()` only handles two
 * things that require an immediate response before the textarea value
 * updates: '/' (to open the dropdown at once) and Escape. No character
 * accumulation is done in `onKeyDown`.
 *
 * `committedMentions` is the payload a future composition-root unit (C6)
 * will fold into its socket `emit` — see `.types.ts`'s header for the
 * camelCase field-naming deviation.
 *
 * **Internal implementation detail of `useSlashMention` — not exported
 * from this slice's public `index.ts` barrel.** Confirmed by grepping the
 * baseline: `useSlashCommandHandler` has exactly one real caller anywhere
 * in the old app, `useSlashMention.hooks.js`; every other file (`ChatBox.jsx`,
 * `NewConversationView.jsx`) reaches it only through `useSlashMention`. The
 * port preserves that shape.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { handleDropdownKeyDown, matchSlashFragment, mergeCommittedMention, resetSlash } from './useSlashCommandHandler.helpers';
import { syncIdlePhase } from './useSlashCommandHandler.idlePhase';
import { syncToolkitPhase, syncToolPhase } from './useSlashCommandHandler.toolPhase';
import type {
  CommittedToolkitMention,
  SlashHandlerContext,
  SlashPhase,
  SlashToolkitRef,
  UseSlashCommandHandlerParams,
  UseSlashCommandHandlerResult,
} from './useSlashCommandHandler.types';

export function useSlashCommandHandler({ setInputContent }: UseSlashCommandHandlerParams = {}): UseSlashCommandHandlerResult {
  const [phase, setPhase] = useState<SlashPhase>('idle');
  // phaseRef mirrors phase so onKeyDown/syncWithValue always read the latest value
  // without needing phase in their dependency arrays (avoids stale closures).
  const phaseRef = useRef<SlashPhase>('idle');

  const [toolkitQuery, setToolkitQuery] = useState('');
  const [toolQuery, setToolQuery] = useState('');
  const [selectedToolkit, setSelectedToolkit] = useState<SlashToolkitRef | null>(null);
  const [committedMentions, setCommittedMentionsState] = useState<readonly CommittedToolkitMention[]>([]);
  const [isQueryFinal, setIsQueryFinal] = useState(false);

  // Keyboard navigation for the suggestion dropdown.
  const [activeIndex, setActiveIndexState] = useState(0);
  const activeIndexRef = useRef(0);
  const itemCountRef = useRef(0);
  const onConfirmActiveRef = useRef<((index: number) => void) | null>(null);

  // When in toolkit phase and a second '/' is detected in the text (fullMatch),
  // this stores the tool-query portion so selectToolkit can seed toolQuery correctly.
  const pendingToolQueryRef = useRef('');
  // Remembers the last selected toolkit for the regex fallback path in idle phase.
  const lastToolkitRef = useRef<SlashToolkitRef | null>(null);
  // committedMentionsRef mirrors committedMentions so syncWithValue can always
  // read the latest value without listing it in the dependency array.
  const committedMentionsRef = useRef<readonly CommittedToolkitMention[]>([]);
  // Character index in the full text where the currently-editing mention starts (the '/').
  const mentionAnchorRef = useRef<number | null>(null);

  const setActiveIndex = useCallback((index: number) => {
    activeIndexRef.current = index;
    setActiveIndexState(index);
  }, []);

  const setCommittedMentions = useCallback(
    (updater: (prev: readonly CommittedToolkitMention[]) => readonly CommittedToolkitMention[]) => {
      const next = updater(committedMentionsRef.current);
      committedMentionsRef.current = next;
      setCommittedMentionsState(next);
    },
    [],
  );

  // `ctx.refs`' accessor properties read/write the `useRef` boxes above directly —
  // no copy-in/copy-out step, `ctx` is a stable object built once.
  const ctx: SlashHandlerContext = useMemo(
    () => ({
      refs: {
        get phaseCurrent() {
          return phaseRef.current;
        },
        set phaseCurrent(value: SlashPhase) {
          phaseRef.current = value;
        },
        get pendingToolQuery() {
          return pendingToolQueryRef.current;
        },
        set pendingToolQuery(value: string) {
          pendingToolQueryRef.current = value;
        },
        get lastToolkit() {
          return lastToolkitRef.current;
        },
        set lastToolkit(value: SlashToolkitRef | null) {
          lastToolkitRef.current = value;
        },
        get committedMentions() {
          return committedMentionsRef.current;
        },
        set committedMentions(value: readonly CommittedToolkitMention[]) {
          committedMentionsRef.current = value;
        },
        get mentionAnchor() {
          return mentionAnchorRef.current;
        },
        set mentionAnchor(value: number | null) {
          mentionAnchorRef.current = value;
        },
        get activeIndex() {
          return activeIndexRef.current;
        },
        set activeIndex(value: number) {
          activeIndexRef.current = value;
        },
      },
      setters: { setPhase, setToolkitQuery, setToolQuery, setSelectedToolkit, setIsQueryFinal, setCommittedMentions, setActiveIndex },
    }),
    [setCommittedMentions, setActiveIndex],
  );

  const doResetSlash = useCallback(() => resetSlash(ctx), [ctx]);

  /**
   * Handles keypresses that need an immediate reaction before the textarea value updates.
   * - '/' in idle  → open toolkit dropdown right away (before onChange fires)
   * - '/' in toolkit → mark isQueryFinal so the auto-select effect runs
   * - Escape        → dismiss
   * Everything else is handled by syncWithValue.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const currentPhase = phaseRef.current;

      // ── Dropdown keyboard navigation (active when suggestion list is visible) ──
      if (currentPhase !== 'idle' && handleDropdownKeyDown(event, itemCountRef.current, activeIndexRef.current, setActiveIndex, onConfirmActiveRef)) {
        return;
      }

      if (currentPhase === 'idle' && event.key === '/') {
        phaseRef.current = 'toolkit';
        setPhase('toolkit');
        setToolkitQuery('');
        setIsQueryFinal(false);
        // mentionAnchorRef is set by syncWithValue on the subsequent onChange.
        return;
      }

      if (currentPhase === 'toolkit' && event.key === '/') {
        // User typed the separator slash — signal that the toolkit name is complete.
        setIsQueryFinal(true);
        return;
      }

      if (event.key === 'Escape' && currentPhase !== 'idle') {
        doResetSlash();
      }
    },
    [doResetSlash, setActiveIndex],
  );

  /**
   * Sync hook state from the actual textarea value on every onChange.
   * Handles typing, backspace, Delete, cut, and paste uniformly.
   *
   * @param text current full input text
   * @param cursorPos current cursor position (selectionStart after the change);
   *   when omitted, falls back to full-text matching.
   */
  const syncWithValue = useCallback(
    (text: string, cursorPos?: number | null) => {
      const currentPhase = phaseRef.current;
      // Use text up to the cursor for detection so that editing an earlier mention
      // in the middle of the input doesn't get confused by later mentions.
      const textToCursor = cursorPos != null ? text.slice(0, cursorPos) : text;
      const { fullMatch, toolkitOnlyMatch } = matchSlashFragment(textToCursor);

      if (currentPhase === 'idle') {
        syncIdlePhase(ctx, textToCursor, cursorPos, fullMatch, toolkitOnlyMatch);
      } else if (currentPhase === 'toolkit') {
        syncToolkitPhase(ctx, textToCursor, cursorPos, fullMatch, toolkitOnlyMatch);
      } else if (currentPhase === 'tool') {
        syncToolPhase(ctx, textToCursor, selectedToolkit);
      }
    },
    [ctx, selectedToolkit],
  );

  /** Called when the user selects a toolkit from the dropdown — advances to 'tool' phase and eagerly commits a toolkit-only mention (refined by `commitMention` once a tool is picked or the mention is finalised). */
  const selectToolkit = useCallback(
    (toolkit: SlashToolkitRef) => {
      lastToolkitRef.current = toolkit;
      setSelectedToolkit(toolkit);
      phaseRef.current = 'tool';
      setPhase('tool');
      // Seed toolQuery from whatever was typed after the second '/' (may be '').
      setToolQuery(pendingToolQueryRef.current);
      pendingToolQueryRef.current = '';
      setIsQueryFinal(false);
      setCommittedMentions((prev) =>
        mergeCommittedMention(prev, {
          toolkitId: toolkit.id,
          projectId: toolkit.projectId,
          toolkitName: toolkit.name,
          toolkitType: toolkit.type,
          ...(toolkit.settings !== undefined ? { toolkitSettings: toolkit.settings } : {}),
          toolName: null,
        }),
      );
    },
    [setCommittedMentions],
  );

  /**
   * Commits the current mention.
   * `toolName: null | undefined | ''` → mention the entire toolkit (LLM picks the tool).
   * `toolName: string` (non-empty) → mention a specific tool.
   *
   * Falsy check (not nullish) on purpose — `useSlashCommandHandler.hooks.js:563`'s
   * `commitMention` normalizes with `toolName || null`, so an empty-string
   * `toolName` is coerced to "whole toolkit" the same as `null`/`undefined`.
   */
  const commitMention = useCallback(
    (toolName?: string | null) => {
      if (!selectedToolkit) return;
      setCommittedMentions((prev) =>
        mergeCommittedMention(prev, {
          toolkitId: selectedToolkit.id,
          projectId: selectedToolkit.projectId,
          toolkitName: selectedToolkit.name,
          toolkitType: selectedToolkit.type,
          ...(selectedToolkit.settings !== undefined ? { toolkitSettings: selectedToolkit.settings } : {}),
          toolName: toolName || null,
        }),
      );
      doResetSlash();
    },
    [selectedToolkit, doResetSlash, setCommittedMentions],
  );

  /** Removes a specific mention by index (e.g. the user clicks the × on a chip). */
  const removeMention = useCallback(
    (index: number) => {
      setCommittedMentions((prev) => prev.filter((_, i) => i !== index));
    },
    [setCommittedMentions],
  );

  /** Call after a successful message send to clear the pending mentions. */
  const clearMentions = useCallback(() => {
    setCommittedMentions(() => []);
    setInputContent?.('');
  }, [setInputContent, setCommittedMentions]);

  return {
    phase,
    toolkitQuery,
    toolQuery,
    selectedToolkit,
    committedMentions,
    isQueryFinal,
    onKeyDown,
    syncWithValue,
    selectToolkit,
    commitMention,
    removeMention,
    clearMentions,
    resetSlash: doResetSlash,
    mentionAnchorRef,
    activeIndex,
    setActiveIndex,
    itemCountRef,
    onConfirmActiveRef,
  };
}
