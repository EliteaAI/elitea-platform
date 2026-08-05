import { useCallback, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { MentionPhase, SKILL_TRIGGER, type MentionPhaseValue } from '../constants/mention.constants';
import type { CommittedMention, SelectedMentionItem } from './useInstructionsSlashCommand.hooks';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/agent/lib/hooks/useInstructionsTildaCommand.hooks.js`
 * (byte-for-byte state-machine logic — same "no external deps to redesign
 * around" situation as `useInstructionsSlashCommand.hooks.ts`).
 *
 * State machine for "~" skill-mention in the agent instructions textarea —
 * the same 'idle'/'items' two-phase shape as the "/" machine, minus the
 * 'tools' drill-down phase (skills have no sub-tools to pick from).
 */

export interface UseInstructionsTildaCommandResult {
  readonly phase: MentionPhaseValue;
  readonly itemQuery: string;
  readonly committedMentions: readonly CommittedMention[];
  readonly onKeyDown: (event: { readonly key: string; readonly target?: { readonly selectionStart?: number } }) => void;
  readonly syncWithValue: (text: string, cursorPos: number | undefined) => void;
  readonly selectItem: (item: SelectedMentionItem) => void;
  readonly resetSlash: () => void;
  readonly initCommittedMentions: (mentions: readonly CommittedMention[]) => void;
  readonly mentionAnchorRef: RefObject<number | null>;
}

export function useInstructionsTildaCommand(): UseInstructionsTildaCommandResult {
  const [phase, setPhase] = useState<MentionPhaseValue>(MentionPhase.Idle);
  const phaseRef = useRef<MentionPhaseValue>(MentionPhase.Idle);

  const [itemQuery, setItemQuery] = useState('');
  const [committedMentions, setCommittedMentions] = useState<readonly CommittedMention[]>([]);
  const committedMentionsRef = useRef<readonly CommittedMention[]>([]);

  const mentionAnchorRef = useRef<number | null>(null);

  // "~name" up to whitespace. Skill names are kebab-case (lowercase, digits,
  // hyphens — no spaces), so whitespace terminates the mention, mirroring the "/" machine.
  const itemRegex = useMemo(() => {
    const t = SKILL_TRIGGER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${t}([^/\\s]*)$`);
  }, []);

  const reset = useCallback(() => {
    phaseRef.current = MentionPhase.Idle;
    setPhase(MentionPhase.Idle);
    setItemQuery('');
    mentionAnchorRef.current = null;
  }, []);

  const upsertMention = useCallback((name: string) => {
    setCommittedMentions((prev) => {
      if (prev.some((m) => m.name === name)) return prev;
      const next = [...prev, { name, tool_name: null }];
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

  const onKeyDown = useCallback(
    (event: { readonly key: string; readonly target?: { readonly selectionStart?: number } }) => {
      const { key } = event;
      const current = phaseRef.current;

      if (current === MentionPhase.Idle && key === SKILL_TRIGGER) {
        phaseRef.current = MentionPhase.Items;
        setPhase(MentionPhase.Items);
        setItemQuery('');
        mentionAnchorRef.current = event.target?.selectionStart ?? null;
        return;
      }

      if (key === 'Escape' && current !== MentionPhase.Idle) {
        reset();
      }
    },
    [reset],
  );

  const syncWithValue = useCallback(
    (text: string, cursorPos: number | undefined) => {
      const pos = cursorPos ?? text.length;
      const textToCursor = text.slice(0, pos);
      const current = phaseRef.current;

      if (current === MentionPhase.Idle) {
        const match = itemRegex.exec(textToCursor);
        if (match?.[1] !== undefined && match[1].length > 0) {
          const committed = committedMentionsRef.current.find((m) =>
            m.name.toLowerCase().startsWith((match[1] ?? '').toLowerCase()),
          );
          if (committed) {
            uncommitByName(committed.name);
            setItemQuery(match[1]);
            phaseRef.current = MentionPhase.Items;
            setPhase(MentionPhase.Items);
            if (mentionAnchorRef.current === null) {
              mentionAnchorRef.current = pos - match[0].length;
            }
          }
        }
        return;
      }

      const match = itemRegex.exec(textToCursor);
      if (match?.[1] !== undefined) {
        setItemQuery(match[1]);
        if (mentionAnchorRef.current === null) {
          mentionAnchorRef.current = pos - match[0].length;
        }
      } else {
        reset();
      }
    },
    [reset, uncommitByName, itemRegex],
  );

  const selectItem = useCallback(
    (item: SelectedMentionItem) => {
      upsertMention(item.name);
      reset();
    },
    [upsertMention, reset],
  );

  return {
    phase,
    itemQuery,
    committedMentions,
    onKeyDown,
    syncWithValue,
    selectItem,
    resetSlash: reset,
    initCommittedMentions,
    mentionAnchorRef,
  };
}
