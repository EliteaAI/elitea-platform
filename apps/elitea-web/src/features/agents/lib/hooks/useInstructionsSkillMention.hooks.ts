import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { MentionPhase, SKILL_TRIGGER } from '../constants/mention.constants';
import { useListApplicationSkills } from '@/shared/api/generated/skills/skills';
import type { Skill } from '@/shared/api/generated/model';
import { unwrapList } from '@/shared/api/unwrap';
import {
  createMentionCmExtension,
  parseMentionRanges,
  type MentionableItem,
} from '../utils/instructionsMention.utils';
import { useInstructionsTildaCommand } from './useInstructionsTildaCommand.hooks';
import type { CommittedMention } from './useInstructionsSlashCommand.hooks';
import type { FileReaderInputHandle } from './useInstructionsMention.hooks';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/agent/lib/hooks/useInstructionsSkillMention.hooks.js`.
 *
 * Wires the "~" skill-mention state machine ({@link useInstructionsTildaCommand})
 * to the instructions textarea text manipulation via the `FileReaderInput`
 * component ref.
 *
 * **DEVIATIONS FROM BASELINE (disclosed):**
 *
 *  1. `useGetApplicationSkillsQuery` (`@/[fsd]/features/skill/api`, an RTK
 *     Query hook from a NOT-YET-BUILT `features/skill` slice in this app —
 *     `no-sideways-features` would forbid importing it from here even if it
 *     existed) -> the real generated endpoint `useListApplicationSkills`
 *     (`shared/api/generated/skills/skills.ts`), called directly. `shared/`
 *     is a layer every `features/` slice may import freely (spec §3.2), so
 *     this sidesteps the cross-feature question entirely rather than
 *     needing an injected callback.
 *
 *  2. `skill.skill_id` -> the real generated `Skill` schema
 *     (`shared/api/generated/model/skill.zod.ts`) has an `id` field, not
 *     `skill_id` (verified by reading the schema directly — no
 *     `skill_id`/`icon_meta` field anywhere on it, both grepped for). Mapped
 *     `skill.id -> skill_id` here (same field, real backend name) rather
 *     than inventing a `skill_id` that does not exist on the wire.
 *
 *  3. `skill.icon_meta` -> DROPPED. No field on the real generated `Skill`
 *     schema; a real, disclosed shape gap (skills currently render without a
 *     per-skill icon in the mention dropdown until the backend adds one),
 *     not invented.
 */

export interface FilteredSkillMentionItem {
  readonly name: string;
  readonly description: string | undefined;
  readonly skill_id: string;
  readonly isToolkit: false;
}

export interface UseInstructionsSkillMentionParams {
  readonly fileReaderRef: RefObject<FileReaderInputHandle | null>;
  readonly projectId: string | undefined;
  readonly versionId: string | number | undefined;
  readonly instructions: string | undefined;
  readonly highlightColor: string;
}

export interface UseInstructionsSkillMentionResult {
  readonly phase: (typeof MentionPhase)[keyof typeof MentionPhase];
  readonly committedMentions: readonly CommittedMention[];
  readonly mentionableItems: readonly FilteredSkillMentionItem[];
  readonly filteredItems: readonly FilteredSkillMentionItem[];
  readonly highlightedIndex: number;
  readonly highlightRanges: ReturnType<typeof parseMentionRanges>;
  readonly codeMirrorExtensions: ReturnType<typeof createMentionCmExtension>;
  readonly onKeyDown: (event: {
    readonly key: string;
    readonly target?: { readonly selectionStart?: number };
    readonly preventDefault: () => void;
  }) => void;
  readonly onInstructionsInputChange: (value: string) => void;
  readonly onSelectItem: (item: FilteredSkillMentionItem) => void;
  readonly resetSlash: () => void;
}

export function useInstructionsSkillMention({
  fileReaderRef,
  projectId,
  versionId,
  instructions,
  highlightColor,
}: UseInstructionsSkillMentionParams): UseInstructionsSkillMentionResult {
  const inputContentRef = useRef('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const appVersionId = typeof versionId === 'string' ? Number(versionId) : versionId;
  const query = useListApplicationSkills(projectId ?? '', appVersionId ?? Number.NaN, {
    query: { enabled: projectId !== undefined && appVersionId !== undefined && !Number.isNaN(appVersionId) },
  });
  // R-A6 (#132): the envelope + body shape is decided in one place, not
  // asserted by a cast here that renders as "no skills" when it is wrong.
  const skills = useMemo(() => unwrapList<Skill>(query.data, 'listApplicationSkills'), [query.data]);

  const mentionableItems: readonly FilteredSkillMentionItem[] = useMemo(
    () =>
      skills
        .map((skill) => ({
          name: skill.name,
          description: skill.description,
          skill_id: skill.id,
          isToolkit: false as const,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [skills],
  );

  const {
    phase,
    itemQuery,
    committedMentions,
    onKeyDown: skillOnKeyDown,
    syncWithValue,
    selectItem,
    resetSlash,
    initCommittedMentions,
    mentionAnchorRef,
  } = useInstructionsTildaCommand();

  useEffect(() => {
    const text = instructions;
    if (!text || !mentionableItems.length) return;

    const mentions: CommittedMention[] = [];
    const sortedItems = [...mentionableItems].sort((a, b) => b.name.length - a.name.length);

    for (const item of sortedItems) {
      const baseToken = SKILL_TRIGGER + item.name;
      let pos = text.indexOf(baseToken);
      while (pos !== -1) {
        const prevChar = pos > 0 ? text[pos - 1] : '';
        const after = text.slice(pos + baseToken.length);
        if (
          (prevChar === '' || (prevChar !== undefined && /\s/.test(prevChar))) &&
          (after === '' || (after[0] !== undefined && /\s/.test(after[0])))
        ) {
          mentions.push({ name: item.name, tool_name: null });
        }
        pos = text.indexOf(baseToken, pos + 1);
      }
    }

    const seen = new Set<string>();
    const unique = mentions.filter((m) => {
      if (seen.has(m.name)) return false;
      seen.add(m.name);
      return true;
    });

    initCommittedMentions(unique);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, mentionableItems.length]);

  const filteredItems = useMemo(() => {
    if (!mentionableItems.length) return [];
    if (!itemQuery) return mentionableItems;
    return mentionableItems.filter((item) => item.name.toLowerCase().includes(itemQuery.toLowerCase()));
  }, [mentionableItems, itemQuery]);

  const replaceFragment = useCallback(
    (replacement: string, endOverride?: number) => {
      const ref = fileReaderRef.current;
      if (!ref) return;

      const content = ref.getInputContent?.() ?? inputContentRef.current;
      const anchor = mentionAnchorRef.current ?? 0;
      const end = endOverride ?? ref.getCursorPosition?.() ?? content.length;

      ref.replaceRange?.(anchor, end, replacement);
      inputContentRef.current = content.slice(0, anchor) + replacement + content.slice(end);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileReaderRef],
  );

  const onInstructionsInputChange = useCallback(
    (value: string) => {
      inputContentRef.current = value;
      if (!value) {
        resetSlash();
        return;
      }
      const cursorPos = fileReaderRef.current?.getCursorPosition?.() ?? value.length;
      syncWithValue(value, cursorPos);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncWithValue, resetSlash],
  );

  const onSelectItem = useCallback(
    (item: FilteredSkillMentionItem) => {
      const replacement = SKILL_TRIGGER + item.name + ' ';
      replaceFragment(replacement);
      selectItem(item);
    },
    [replaceFragment, selectItem],
  );

  useEffect(() => {
    setHighlightedIndex(0);
  }, [phase, filteredItems]);

  const onKeyDown = useCallback(
    (event: { readonly key: string; readonly target?: { readonly selectionStart?: number }; readonly preventDefault: () => void }) => {
      const { key } = event;

      if (phase === MentionPhase.Items && filteredItems.length > 0) {
        if (key === 'ArrowDown') {
          event.preventDefault();
          setHighlightedIndex((prev) => (prev + 1) % filteredItems.length);
          return;
        }
        if (key === 'ArrowUp') {
          event.preventDefault();
          setHighlightedIndex((prev) => (prev <= 0 ? filteredItems.length - 1 : prev - 1));
          return;
        }
        if (key === 'Enter' && highlightedIndex >= 0) {
          event.preventDefault();
          const item = filteredItems[highlightedIndex];
          if (item) onSelectItem(item);
          return;
        }
      }

      skillOnKeyDown(event);
    },
    [phase, filteredItems, highlightedIndex, onSelectItem, skillOnKeyDown],
  );

  const highlightRanges = useMemo(
    () => parseMentionRanges(instructions ?? '', mentionableItems as readonly MentionableItem[], SKILL_TRIGGER),
    [instructions, mentionableItems],
  );

  const codeMirrorExtensions = useMemo(
    () => createMentionCmExtension(mentionableItems as readonly MentionableItem[], highlightColor, SKILL_TRIGGER),
    [mentionableItems, highlightColor],
  );

  return {
    phase,
    committedMentions,
    mentionableItems,
    filteredItems,
    highlightedIndex,
    highlightRanges,
    codeMirrorExtensions,
    onKeyDown,
    onInstructionsInputChange,
    onSelectItem,
    resetSlash,
  };
}
