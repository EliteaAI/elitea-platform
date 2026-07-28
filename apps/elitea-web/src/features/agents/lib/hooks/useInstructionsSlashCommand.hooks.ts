import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { MentionPhase, type MentionPhaseValue } from '../constants/mention.constants';
import {
  syncIdlePhase,
  syncItemsPhase,
  syncToolsPhase,
  type CommittedMention,
  type SelectedMentionItem,
  type SlashSyncActions,
} from './slashCommandSync.helpers';

// Re-exported for existing consumers (`useInstructionsMention.hooks.ts` et al.) — the canonical
// declarations now live in `slashCommandSync.helpers.ts` to avoid an import cycle (R-L2: this
// file imports FROM that one, so that one cannot import types back from this one).
export type { CommittedMention, SelectedMentionItem };

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/agent/lib/hooks/useInstructionsSlashCommand.hooks.js`
 * (byte-for-byte state-machine logic; no external dependencies to redesign
 * around — the baseline itself takes no props and touches no form/API
 * layer).
 *
 * State machine for "/" slash-mention in the agent instructions textarea.
 *
 * Phases:
 *   'idle'  -> no active mention
 *   'items' -> user typed "/" and is filtering agents/pipelines/toolkits/MCPs
 *   'tools' -> user selected a toolkit/MCP; filtering its specific tools
 *
 * `committedMentions`: `[{name, tool_name}]`
 *   `name`      - agent/toolkit name (appears as `/name` in text)
 *   `tool_name` - specific tool within a toolkit (`null` for agents/
 *                 pipelines or when the whole toolkit is mentioned)
 *
 * Token written to textarea:
 *   agent/pipeline                -> "/Name "
 *   toolkit without specific tool -> "/Name "
 *   toolkit with specific tool    -> "/Name/ToolName "
 *
 * `mentionAnchorRef`: character index of the leading "/" in the current mention.
 */

export interface UseInstructionsSlashCommandResult {
  readonly phase: MentionPhaseValue;
  readonly itemQuery: string;
  readonly toolQuery: string;
  readonly selectedItem: SelectedMentionItem | null;
  readonly committedMentions: readonly CommittedMention[];
  readonly onKeyDown: (event: { readonly key: string; readonly target?: { readonly selectionStart?: number } }) => void;
  readonly syncWithValue: (text: string, cursorPos: number | undefined) => void;
  readonly selectItem: (item: SelectedMentionItem, isToolkit: boolean) => void;
  readonly commitMention: (toolName?: string | null) => void;
  readonly resetSlash: () => void;
  readonly resetAll: () => void;
  readonly initCommittedMentions: (mentions: readonly CommittedMention[]) => void;
  readonly mentionAnchorRef: RefObject<number | null>;
}

export function useInstructionsSlashCommand(): UseInstructionsSlashCommandResult {
  const [phase, setPhase] = useState<MentionPhaseValue>(MentionPhase.Idle);
  const phaseRef = useRef<MentionPhaseValue>(MentionPhase.Idle);

  const [itemQuery, setItemQuery] = useState('');
  const [toolQuery, setToolQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<SelectedMentionItem | null>(null);
  const [committedMentions, setCommittedMentions] = useState<readonly CommittedMention[]>([]);

  const committedMentionsRef = useRef<readonly CommittedMention[]>([]);

  // Character index of the leading "/" that started this mention.
  const mentionAnchorRef = useRef<number | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const resetSlash = useCallback(() => {
    phaseRef.current = MentionPhase.Idle;
    setPhase(MentionPhase.Idle);
    setItemQuery('');
    setToolQuery('');
    setSelectedItem(null);
    mentionAnchorRef.current = null;
  }, []);

  const resetAll = useCallback(() => {
    phaseRef.current = MentionPhase.Idle;
    setPhase(MentionPhase.Idle);
    setItemQuery('');
    setToolQuery('');
    setSelectedItem(null);
    mentionAnchorRef.current = null;
    setCommittedMentions([]);
    committedMentionsRef.current = [];
  }, []);

  const upsertMention = useCallback((name: string, tool_name: string | null = null) => {
    setCommittedMentions((prev) => {
      const alreadyPresent = prev.some((m) => m.name === name && m.tool_name === tool_name);
      const next = alreadyPresent ? prev : [...prev, { name, tool_name }];
      committedMentionsRef.current = next;
      return next;
    });
  }, []);

  const uncommitByName = useCallback((name: string) => {
    setCommittedMentions((prev) => {
      const next = prev.filter((m) => m.name !== name);
      committedMentionsRef.current = next;
      return next;
    });
  }, []);

  const initCommittedMentions = useCallback((mentions: readonly CommittedMention[]) => {
    committedMentionsRef.current = mentions;
    setCommittedMentions(mentions);
  }, []);

  // ── Keyboard handler ─────────────────────────────────────────────────────────

  const onKeyDown = useCallback(
    (event: { readonly key: string; readonly target?: { readonly selectionStart?: number } }) => {
      const { key } = event;
      const current = phaseRef.current;

      if (current === MentionPhase.Idle && key === '/') {
        phaseRef.current = MentionPhase.Items;
        setPhase(MentionPhase.Items);
        setItemQuery('');
        // For a textarea, selectionStart is the position where '/' will be inserted.
        // For CodeMirror the property is absent — anchor is set later in syncWithValue.
        mentionAnchorRef.current = event.target?.selectionStart ?? null;
        return;
      }

      if (key === 'Escape' && current !== MentionPhase.Idle) {
        resetSlash();
      }
    },
    [resetSlash],
  );

  // ── Sync ─────────────────────────────────────────────────────────────────────

  const setPhaseTo = useCallback((next: MentionPhaseValue) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const syncWithValue = useCallback(
    (text: string, cursorPos: number | undefined) => {
      const pos = cursorPos ?? text.length;
      const actions: SlashSyncActions = {
        committedMentionsRef,
        mentionAnchorRef,
        selectedItem,
        uncommitByName,
        setSelectedItem,
        setItemQuery,
        setToolQuery,
        setPhaseTo,
        resetSlash,
      };

      switch (phaseRef.current) {
        case MentionPhase.Idle:
          syncIdlePhase(text, pos, actions);
          return;
        case MentionPhase.Items:
          syncItemsPhase(text, pos, actions);
          return;
        case MentionPhase.Tools:
          syncToolsPhase(text, pos, actions);
          return;
        default:
          return;
      }
    },
    [resetSlash, selectedItem, setPhaseTo, uncommitByName],
  );

  // ── Selection handlers ────────────────────────────────────────────────────────

  const selectItem = useCallback(
    (item: SelectedMentionItem, isToolkit: boolean) => {
      if (!isToolkit) {
        upsertMention(item.name, null);
        resetSlash();
        return;
      }
      setSelectedItem(item);
      setItemQuery(item.name);
      setToolQuery('');
      upsertMention(item.name, null);
      phaseRef.current = MentionPhase.Tools;
      setPhase(MentionPhase.Tools);
    },
    [resetSlash, upsertMention],
  );

  const commitMention = useCallback(
    (toolName: string | null = null) => {
      if (!selectedItem) return;
      upsertMention(selectedItem.name, toolName || null);
      resetSlash();
    },
    [selectedItem, upsertMention, resetSlash],
  );

  return {
    phase,
    itemQuery,
    toolQuery,
    selectedItem,
    committedMentions,
    onKeyDown,
    syncWithValue,
    selectItem,
    commitMention,
    resetSlash,
    resetAll,
    initCommittedMentions,
    mentionAnchorRef,
  };
}
