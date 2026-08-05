import { useMemo } from 'react';

/**
 * Ported from `apps/elitea-ui/src/ComponentsLib/Chat/useMentionDetection.js`
 * — a sibling file of `ComponentsLib/Chat/UserInput.jsx` in the baseline
 * (same directory, hard-imported as `./useMentionDetection`).
 *
 * **Disclosed judgment call**: `parity/wave2-partition.json` lists this
 * file's path under unit C4's ("chat-messages") `ownedPaths`, but
 * `UserInput.tsx` (this unit, C3) hard-imports it directly for its own
 * `@mention` detection (the `mentionUser` slotProp's `users`/
 * `onMentionChange`) — and `features/chat-input` can never legally import
 * `features/chat-messages` (`no-sideways-features` is absolute, same fence
 * that forces `SendButton`/`HighlightedText`/`FileList` into injected
 * slots elsewhere in this file). Unlike those three, this is not a
 * *component* another unit renders — it is a small, pure, generic
 * text-matching hook with zero rendering and zero feature-specific
 * coupling, exactly analogous to `useCtrlEnterKeyEventsHandler`/
 * `useFileDragAndDrop` (both also ported locally into this same `lib/`
 * for an identical "small hook, no shared home" reason). Ported locally
 * here rather than slotted. If unit C4 also needs this logic for its own
 * message-rendering consumer, an independent local copy there is the
 * accepted outcome — same "two independent local ports of a small
 * shared-shaped utility" pattern already established by
 * `features/agents/ui/AgentVariables.tsx`'s disclosed `VariableList`
 * duplication.
 */

export interface MentionCandidate {
  readonly name?: string;
  readonly [key: string]: unknown;
}

export interface MentionMatch {
  readonly text: string;
  readonly username: string;
  readonly user: MentionCandidate;
  readonly start: number;
  readonly end: number;
  readonly isValid: boolean;
  readonly isPartial: boolean;
}

export interface UseMentionDetectionOptions {
  readonly allowPartialMatches?: boolean;
  readonly caseSensitive?: boolean;
  readonly minMatchLength?: number;
}

interface BestMatch {
  readonly user: MentionCandidate;
  readonly matchedText: string;
  readonly length: number;
  readonly isPartial?: boolean;
}

function findExactMatch(
  remainingText: string,
  sortedUsers: readonly MentionCandidate[],
  nameField: string,
  caseSensitive: boolean,
): BestMatch | null {
  let bestMatch: BestMatch | null = null;
  let longestMatchLength = 0;

  for (const user of sortedUsers) {
    const userName = user[nameField];
    if (typeof userName !== 'string' || userName === '') continue;

    const userNameToCheck = caseSensitive ? userName : userName.toLowerCase();
    const remainingTextToCheck = caseSensitive ? remainingText : remainingText.toLowerCase();
    if (!remainingTextToCheck.startsWith(userNameToCheck)) continue;

    const endPos = userName.length;
    const charAfterMatch = remainingText[endPos];
    const isCompleteWord = charAfterMatch === undefined || /[\s.,!?;:\n]/.test(charAfterMatch);
    if (isCompleteWord && userName.length > longestMatchLength) {
      bestMatch = { user, matchedText: remainingText.slice(0, endPos), length: userName.length };
      longestMatchLength = userName.length;
    }
  }
  return bestMatch;
}

function findPartialMatch(
  remainingText: string,
  sortedUsers: readonly MentionCandidate[],
  nameField: string,
  caseSensitive: boolean,
  minMatchLength: number,
): BestMatch | null {
  const potentialMatch = /^([^@\n.,!?;:\s]*(?:\s+[^@\n.,!?;:\s]+)*)/.exec(remainingText);
  const potentialMention = (potentialMatch?.[1] ?? '').trim();
  if (potentialMention.length < minMatchLength) return null;

  const partialUser = sortedUsers.find((user) => {
    const userName = user[nameField];
    if (typeof userName !== 'string' || userName === '') return false;
    return caseSensitive
      ? userName.startsWith(potentialMention)
      : userName.toLowerCase().startsWith(potentialMention.toLowerCase());
  });
  if (!partialUser) return null;
  return { user: partialUser, matchedText: potentialMention, length: potentialMention.length, isPartial: true };
}

function isOverlapping(matches: readonly MentionMatch[], start: number, length: number): boolean {
  return matches.some((existing) => start < existing.end && start + length > existing.start);
}

function findMentionsAt(
  text: string,
  sortedUsers: readonly MentionCandidate[],
  nameField: string,
  options: Required<UseMentionDetectionOptions>,
): MentionMatch[] {
  const { allowPartialMatches, caseSensitive, minMatchLength } = options;
  const matches: MentionMatch[] = [];
  const atSymbolRegex = /@/g;
  let atMatch: RegExpExecArray | null;

  while ((atMatch = atSymbolRegex.exec(text)) !== null) {
    const startPos = atMatch.index;
    const remainingText = text.slice(startPos + 1);

    let bestMatch = findExactMatch(remainingText, sortedUsers, nameField, caseSensitive);
    if (!bestMatch && allowPartialMatches) {
      bestMatch = findPartialMatch(remainingText, sortedUsers, nameField, caseSensitive, minMatchLength);
    }

    if (bestMatch && bestMatch.length >= minMatchLength) {
      const mentionText = `@${bestMatch.matchedText}`;
      if (!isOverlapping(matches, startPos, mentionText.length)) {
        matches.push({
          text: mentionText,
          username: bestMatch.matchedText,
          user: bestMatch.user,
          start: startPos,
          end: startPos + mentionText.length,
          isValid: bestMatch.isPartial !== true,
          isPartial: bestMatch.isPartial === true,
        });
      }
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

export function useMentionDetection(
  text: string,
  users: readonly MentionCandidate[] = [],
  nameField = 'name',
  options: UseMentionDetectionOptions = {},
): { readonly mentions: readonly MentionMatch[] } {
  const { allowPartialMatches = false, caseSensitive = false, minMatchLength = 1 } = options;

  const mentions = useMemo(() => {
    if (!text || users.length === 0) return [];
    const sortedUsers = [...users].sort((a, b) => {
      const aName = a[nameField];
      const bName = b[nameField];
      const aLen = typeof aName === 'string' ? aName.length : 0;
      const bLen = typeof bName === 'string' ? bName.length : 0;
      return bLen - aLen;
    });
    return findMentionsAt(text, sortedUsers, nameField, { allowPartialMatches, caseSensitive, minMatchLength });
  }, [text, users, nameField, allowPartialMatches, caseSensitive, minMatchLength]);

  return { mentions };
}
