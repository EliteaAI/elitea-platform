/**
 * Ported from `apps/elitea-ui/src/ComponentsLib/Chat/useMentionDetection.js` —
 * a small, pure, generic text-matching hook for mention detection
 * (@user, ~skill, /toolkit slash commands).
 *
 * Port of `apps/elitea-ui/src/ComponentsLib/Chat/useMentionDetection.js`.
 *
 * Note: this hook is pure and generic with zero rendering — it could
 * theoretically live in `shared/lib`, but the old app colocated it in
 * `ComponentsLib/Chat/` alongside `UserInput.jsx`, and the Wave-2 C3
 * unit already ported a variant into `features/chat-input/lib/hooks/
 * useMentionDetection.hooks.ts`. This port is a local copy to avoid
 * cross-feature coupling.
 */
import { useMemo } from 'react';

/** A mention match found in the input text. */
export interface MentionMatch {
  /** The raw text that was matched. */
  readonly raw: string;
  /** The display string for the match (e.g. "@user"). */
  readonly displayString: string;
  /** The start position (inclusive). */
  readonly start: number;
  /** The end position (exclusive). */
  readonly end: number;
}

/** Parameters for the `useMentionDetection` hook. */
export interface UseMentionDetectionParams {
  /** The current input text. */
  readonly inputContent: string;
  /** The current cursor position. */
  readonly cursorPosition: number | null;
}

/** Result of the `useMentionDetection` hook. */
export interface UseMentionDetectionResult {
  /** The current match being typed (null if no match). */
  readonly match: MentionMatch | null;
  /** Whether a match is currently active. */
  readonly isMentionActive: boolean;
  /** Whether the current character is a mention trigger (@, ~, /). */
  readonly isTrigger: boolean;
}

/**
 * `useMentionDetection` — detects whether the current cursor position
 * in the input text is at a mention trigger (@user, ~skill, /command)
 * and returns the partial match.
 */
export function useMentionDetection({
  inputContent,
  cursorPosition,
}: UseMentionDetectionParams): UseMentionDetectionResult {
  const result = useMemo((): UseMentionDetectionResult => {
    if (cursorPosition === null || !inputContent) {
      return { match: null, isMentionActive: false, isTrigger: false };
    }

    // Find the start of the current word being typed.
    const textBeforeCursor = inputContent.slice(0, cursorPosition);
    const lastSpaceIndex = textBeforeCursor.lastIndexOf(' ');
    const wordStart = lastSpaceIndex === -1 ? 0 : lastSpaceIndex + 1;
    const currentWord = inputContent.slice(wordStart, cursorPosition);

    // Check for mention triggers.
    const triggerChars = ['@', '~', '/'];
    const triggerChar = triggerChars.find((ch) => currentWord.startsWith(ch));

    if (!triggerChar || currentWord.length < 2 || currentWord === triggerChar) {
      return { match: null, isMentionActive: false, isTrigger: false };
    }

    // Extract the mention string after the trigger (unused — reserved for type-based filtering).
    currentWord.slice(1);

    return {
      match: {
        raw: currentWord,
        displayString: currentWord,
        start: wordStart,
        end: cursorPosition,
      },
      isMentionActive: true,
      isTrigger: true,
    };
  }, [inputContent, cursorPosition]);

  return result;
}
