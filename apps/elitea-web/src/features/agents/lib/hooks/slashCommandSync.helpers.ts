import type { RefObject } from 'react';

import { MentionPhase, type MentionPhaseValue } from '../constants/mention.constants';

/**
 * Pure phase-handling logic for `useInstructionsSlashCommand`'s
 * `syncWithValue` state machine — extracted purely to keep every function
 * under this codebase's `complexity` gate (the single-function baseline
 * port measured at complexity 51 against a max of 12). No behaviour
 * differs from the baseline
 * (`apps/elitea-ui/src/[fsd]/features/agent/lib/hooks/
 * useInstructionsSlashCommand.hooks.js`'s `syncWithValue`); every branch
 * below is byte-for-byte the same logic, just split across named
 * functions.
 *
 * `CommittedMention`/`SelectedMentionItem` are declared HERE (not in
 * `useInstructionsSlashCommand.hooks.ts`, despite that file being their
 * "home" hook) specifically to avoid an import cycle: this file needs both
 * types, and that hook file needs this file's `syncIdlePhase`/
 * `syncItemsPhase`/`syncToolsPhase` — R-L2 (§3.4, zero cycles at any
 * granularity) forbids the two importing from each other. That hook file
 * re-exports both types for its existing consumers.
 */
export interface CommittedMention {
  readonly name: string;
  readonly tool_name: string | null;
}

export interface SelectedMentionItem {
  readonly name: string;
}

export interface SlashSyncActions {
  readonly committedMentionsRef: RefObject<readonly CommittedMention[]>;
  readonly mentionAnchorRef: RefObject<number | null>;
  readonly selectedItem: SelectedMentionItem | null;
  readonly uncommitByName: (name: string) => void;
  readonly setSelectedItem: (item: SelectedMentionItem | null) => void;
  readonly setItemQuery: (value: string) => void;
  readonly setToolQuery: (value: string) => void;
  readonly setPhaseTo: (phase: MentionPhaseValue) => void;
  readonly resetSlash: () => void;
}

const FULL_MATCH_RE = /\/([^/\s]+)\/([^/\s]*)$/;
const ITEM_ONLY_RE = /\/([^/\s]*)$/;

function isWordBoundaryChar(char: string | undefined): boolean {
  return char === '' || (char !== undefined && /\s/.test(char));
}

/** `prevChar` in the baseline's two backspace-recovery loops: the character immediately before `candidate` in `textToCursor`, or `''` (start-of-text sentinel) when `candidate` starts at position 0. */
function charBefore(text: string, candidateLength: number): string {
  const idx = text.length - candidateLength - 1;
  return idx >= 0 ? (text[idx] ?? '') : '';
}

/** `syncIdleRegexMatch`'s `fullMatch` (`/Name/ToolName`) branch. Returns `true` when a committed mention was found and re-opened for editing. */
function syncIdleFullMatch(fullMatch: RegExpExecArray, pos: number, actions: SlashSyncActions): boolean {
  const name = fullMatch[1] ?? '';
  const committedMatch = actions.committedMentionsRef.current.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (!committedMatch) return false;
  actions.uncommitByName(committedMatch.name);
  actions.setSelectedItem({ name: committedMatch.name });
  actions.setItemQuery(name);
  actions.setToolQuery(fullMatch[2] ?? '');
  actions.setPhaseTo(MentionPhase.Tools);
  if (actions.mentionAnchorRef.current === null) actions.mentionAnchorRef.current = pos - fullMatch[0].length;
  return true;
}

/** `syncIdleRegexMatch`'s `itemOnlyMatch` (bare `/Name`) branch. Returns `true` when a committed mention was found and re-opened for editing. */
function syncIdleItemOnlyMatch(itemOnlyMatch: RegExpExecArray, pos: number, actions: SlashSyncActions): boolean {
  const name = itemOnlyMatch[1] ?? '';
  if (name.length === 0) return false;
  const committedMatch = actions.committedMentionsRef.current.find((m) => m.name.toLowerCase().startsWith(name.toLowerCase()));
  if (!committedMatch) return false;
  actions.uncommitByName(committedMatch.name);
  actions.setItemQuery(name);
  actions.setPhaseTo(MentionPhase.Items);
  if (actions.mentionAnchorRef.current === null) actions.mentionAnchorRef.current = pos - itemOnlyMatch[0].length;
  return true;
}

/** `syncWithValue`'s idle-phase regex-match branch (`fullMatch`/`itemOnlyMatch` against a committed mention). Returns `true` when handled (whether or not a committed match was actually found — matches the baseline's own if/else-if structure: a regex match, found or not, never falls through to the fallback search). */
function syncIdleRegexMatch(textToCursor: string, pos: number, actions: SlashSyncActions): boolean {
  const fullMatch = FULL_MATCH_RE.exec(textToCursor);
  if (fullMatch) {
    syncIdleFullMatch(fullMatch, pos, actions);
    return true;
  }

  const itemOnlyMatch = ITEM_ONLY_RE.exec(textToCursor);
  if (itemOnlyMatch) {
    syncIdleItemOnlyMatch(itemOnlyMatch, pos, actions);
    return true;
  }

  return false;
}

/** `syncWithValue`'s idle-phase fallback loop — recovers a backspace INTO a multi-word committed mention name (e.g. "Github mcp"). Returns `true` when handled (a `return` in the baseline). */
function syncIdleFallbackSearch(textToCursor: string, pos: number, actions: SlashSyncActions): boolean {
  for (const mention of actions.committedMentionsRef.current) {
    const fullToken = mention.tool_name ? '/' + mention.name + '/' + mention.tool_name : '/' + mention.name;
    for (let len = fullToken.length; len >= 2; len--) {
      const candidate = fullToken.slice(0, len);
      if (!textToCursor.endsWith(candidate)) continue;
      if (!isWordBoundaryChar(charBefore(textToCursor, candidate.length))) break;

      const sepIdx = candidate.indexOf('/', 1);
      actions.uncommitByName(mention.name);
      if (sepIdx !== -1) {
        actions.setSelectedItem({ name: mention.name });
        actions.setItemQuery(mention.name);
        actions.setToolQuery(candidate.slice(sepIdx + 1));
        actions.setPhaseTo(MentionPhase.Tools);
      } else {
        actions.setItemQuery(candidate.slice(1));
        actions.setPhaseTo(MentionPhase.Items);
      }
      actions.mentionAnchorRef.current = pos - candidate.length;
      return true;
    }
  }
  return false;
}

export function syncIdlePhase(text: string, pos: number, actions: SlashSyncActions): void {
  const textToCursor = text.slice(0, pos);
  if (syncIdleRegexMatch(textToCursor, pos, actions)) return;
  syncIdleFallbackSearch(textToCursor, pos, actions);
}

/** `syncWithValue`'s items-phase anchor-tracking branch (`mentionAnchorRef` still points at a live "/"). Returns `true` when handled. */
function syncItemsPhaseAnchored(text: string, pos: number, actions: SlashSyncActions): boolean {
  const anchor = actions.mentionAnchorRef.current;
  if (anchor === null || text[anchor] !== '/') return false;

  const afterAnchor = text.slice(anchor + 1, pos);
  const sepIdx = afterAnchor.indexOf('/');
  if (sepIdx !== -1) {
    actions.setItemQuery(afterAnchor.slice(0, sepIdx));
    if (actions.selectedItem) {
      actions.setToolQuery(afterAnchor.slice(sepIdx + 1));
      actions.setPhaseTo(MentionPhase.Tools);
    }
  } else if (afterAnchor.endsWith(' ') || afterAnchor.includes('\n')) {
    actions.resetSlash();
  } else {
    actions.setItemQuery(afterAnchor);
  }
  return true;
}

export function syncItemsPhase(text: string, pos: number, actions: SlashSyncActions): void {
  if (syncItemsPhaseAnchored(text, pos, actions)) return;

  const textToCursor = text.slice(0, pos);
  const fullMatch = FULL_MATCH_RE.exec(textToCursor);
  const itemOnlyMatch = !fullMatch ? ITEM_ONLY_RE.exec(textToCursor) : null;

  if (fullMatch?.[1] !== undefined) {
    actions.setItemQuery(fullMatch[1]);
    if (actions.selectedItem) {
      actions.setToolQuery(fullMatch[2] ?? '');
      actions.setPhaseTo(MentionPhase.Tools);
    }
  } else if (itemOnlyMatch?.[1] !== undefined) {
    actions.setItemQuery(itemOnlyMatch[1]);
    if (actions.mentionAnchorRef.current === null) actions.mentionAnchorRef.current = pos - itemOnlyMatch[0].length;
  } else {
    actions.resetSlash();
  }
}

/** `syncWithValue`'s tools-phase "separator deleted, fall back to items" recovery loop. */
function syncToolsPhaseRecover(textToCursor: string, pos: number, nameOnly: string, actions: SlashSyncActions): void {
  for (let len = nameOnly.length - 1; len >= 2; len--) {
    const candidate = nameOnly.slice(0, len);
    if (!textToCursor.endsWith(candidate)) continue;
    if (!isWordBoundaryChar(charBefore(textToCursor, candidate.length))) break;
    actions.uncommitByName(actions.selectedItem?.name ?? '');
    actions.setItemQuery(candidate.slice(1));
    actions.setPhaseTo(MentionPhase.Items);
    actions.mentionAnchorRef.current = pos - candidate.length;
    return;
  }
  actions.resetSlash();
}

export function syncToolsPhase(text: string, pos: number, actions: SlashSyncActions): void {
  if (!actions.selectedItem) {
    actions.resetSlash();
    return;
  }
  const textToCursor = text.slice(0, pos);
  const toolkitPrefix = '/' + actions.selectedItem.name + '/';
  const prefixIdx = textToCursor.lastIndexOf(toolkitPrefix);
  if (prefixIdx !== -1) {
    const toolQueryPart = textToCursor.slice(prefixIdx + toolkitPrefix.length);
    if (/[\s/]/.test(toolQueryPart)) {
      actions.resetSlash();
    } else {
      actions.setToolQuery(toolQueryPart);
    }
    return;
  }

  const nameOnly = '/' + actions.selectedItem.name;
  const nameIdx = textToCursor.lastIndexOf(nameOnly);
  if (nameIdx !== -1 && !/[\s/]/.test(textToCursor.slice(nameIdx + nameOnly.length))) {
    actions.setItemQuery(actions.selectedItem.name);
    actions.setPhaseTo(MentionPhase.Items);
    return;
  }
  syncToolsPhaseRecover(textToCursor, pos, nameOnly, actions);
}
