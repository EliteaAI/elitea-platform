/**
 * Ported from `apps/elitea-ui/src/ComponentsLib/Chat/useMentionDetection.js`
 * — scans finished text for every `@`, matches against a longest-name-first
 * sorted `users` list, and returns `{mentions, textSegments, hasMentions}`
 * for highlighting.
 *
 * `features/chat-input/lib/hooks/useMentionDetection.hooks.ts` (Wave-2 unit
 * C3) already ported this same algorithm's `mentions` half for its own
 * `@mention` autocomplete — `features/chat-messages` cannot import it
 * (`no-sideways-features` forbids importing across sibling features), so
 * this is an independent local copy, restoring the `textSegments`/
 * `hasMentions` output C3 didn't need for its own consumer (it only wires
 * `ranges` into `HighlightedText`'s slot) but this feature's baseline
 * message-rendering consumer (`convertChatConversationMessages.js`-adjacent
 * highlighting) does — same "two independent local ports of a small
 * shared-shaped utility" pattern C3's own docblock already establishes.
 */
import { useMemo } from 'react';

/** A user (or skill/toolkit) candidate `@mention` text can resolve against. */
export interface MentionCandidate {
  readonly name?: string;
  readonly [key: string]: unknown;
}

/** A mention match found in the text. */
export interface MentionMatch {
  readonly text: string;
  readonly username: string;
  readonly user: MentionCandidate;
  readonly start: number;
  readonly end: number;
  readonly isValid: boolean;
  readonly isPartial: boolean;
}

/** One segment of the text split around its mentions — plain text or a resolved mention. */
export type MentionTextSegment =
  | { readonly type: 'text'; readonly content: string }
  | {
      readonly type: 'mention';
      readonly content: string;
      readonly user: MentionCandidate;
      readonly isValid: boolean;
      readonly isPartial: boolean;
    };

export interface UseMentionDetectionOptions {
  readonly allowPartialMatches?: boolean;
  readonly caseSensitive?: boolean;
  readonly minMatchLength?: number;
}

/** Result of the `useMentionDetection` hook. */
export interface UseMentionDetectionResult {
  readonly mentions: readonly MentionMatch[];
  readonly textSegments: readonly MentionTextSegment[];
  readonly hasMentions: boolean;
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

/** Splits `text` into plain-text and mention segments around each match — baseline lines 122-160. */
function buildTextSegments(text: string, mentions: readonly MentionMatch[]): MentionTextSegment[] {
  if (!text) return [];
  if (mentions.length === 0) return [{ type: 'text', content: text }];

  const segments: MentionTextSegment[] = [];
  let lastIndex = 0;

  mentions.forEach((mention) => {
    if (mention.start > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, mention.start) });
    }
    segments.push({
      type: 'mention',
      content: mention.text,
      user: mention.user,
      isValid: mention.isValid,
      isPartial: mention.isPartial,
    });
    lastIndex = mention.end;
  });

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments.filter((segment) => segment.content);
}

/**
 * `useMentionDetection` — scans `text` for `@mentions` against a
 * longest-name-first sorted `users` list and returns the matches, the text
 * split into segments around them, and whether any were found.
 */
export function useMentionDetection(
  text: string,
  users: readonly MentionCandidate[] = [],
  nameField = 'name',
  options: UseMentionDetectionOptions = {},
): UseMentionDetectionResult {
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

  const textSegments = useMemo(() => buildTextSegments(text, mentions), [text, mentions]);

  return { mentions, textSegments, hasMentions: mentions.length > 0 };
}
