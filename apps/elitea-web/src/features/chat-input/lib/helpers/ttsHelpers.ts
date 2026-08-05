/**
 * Ported from
 * apps/elitea-ui/src/[fsd]/features/chat/lib/helpers/tts.helpers.js —
 * `toSpeakableText`/`translateSpokenPos`, a pure markdown-lexer-based
 * transform (`marked@18.0.7`, already a dependency of this app — confirmed
 * via package.json before adding any new one).
 *
 * Split across four files to stay under the §3.5 400-line/complexity-12
 * budgets (the baseline is one 333-line file with several >20-complexity
 * functions): this file owns the public API (`toSpeakableText`/
 * `translateSpokenPos`) and top-level token orchestration;
 * `ttsInline.helpers.ts` owns inline-token conversion; `ttsBlock.helpers.ts`
 * owns block-token conversion; `ttsShared.helpers.ts` owns primitives both
 * share (emoji map, code-block language classification, link/path
 * detection, ordinals). No behavioral change from the single-file baseline
 * — every case, including the baseline's non-real `'strong_em'` token type,
 * is preserved (see `ttsInline.helpers.ts`'s own doc comment).
 */
import { marked, type Token, type Tokens } from 'marked';

import { blockText, listSegments } from './ttsBlock.helpers';
import type { SpeakableText, TtsSegment } from './ttsHelpers.types';
import { inlineTextSegments } from './ttsInline.helpers';

export type { SpeakableText, TtsSegment };

interface TopLevelStep {
  readonly piece: string;
  readonly segments: readonly TtsSegment[];
}

/**
 * Converts ONE top-level (block) token into its speakable piece + position
 * segments, or `null` when the token contributes nothing to speak (`space`/
 * `html`, or an empty result). Split out of `toSpeakableText`'s own loop
 * body purely to keep that function's complexity under budget.
 */
function topLevelStep(token: Token, origStart: number, strippedPos: number): TopLevelStep | null {
  if (token.type === 'space' || token.type === 'html') return null;

  if (token.type === 'paragraph' || token.type === 'heading') {
    // Fine-grained inline segments: one segment per leaf text run so
    // translateSpokenPos gives word-level accuracy for highlight.
    const { text: inlineResult, segments } = inlineTextSegments((token as Tokens.Paragraph | Tokens.Heading).tokens, origStart, strippedPos);
    return inlineResult ? { piece: inlineResult + '\n', segments } : null;
  }

  if (token.type === 'list') {
    // Per-item segments so each list item is highlighted individually.
    const { text, segments } = listSegments(token as Tokens.List, origStart, strippedPos);
    return text ? { piece: text, segments } : null;
  }

  // Coarse segment for code blocks, tables, blockquotes, etc.
  const piece = blockText([token]);
  if (!piece) return null;
  return { piece, segments: [{ origStart, origLen: token.raw.length, strippedStart: strippedPos, strippedLen: piece.length }] };
}

/** Trims the joined text and shifts every segment's `strippedStart` to account for whitespace `trim()` removed from the front. */
function finalizeSpeakableText(parts: readonly string[], segments: readonly TtsSegment[]): SpeakableText {
  const joined = parts.join('');
  const leadingWhitespace = joined.length - joined.trimStart().length;
  const text = joined.replace(/\n{3,}/g, '\n\n').trim();

  if (leadingWhitespace > 0) {
    for (const seg of segments) {
      seg.strippedStart = Math.max(0, seg.strippedStart - leadingWhitespace);
    }
  }

  return { text, segments };
}

/**
 * Convert a markdown string to plain text suitable for TTS.
 *
 * Replaces code blocks, tables, diagrams, and data blocks with spoken
 * placeholders; reads inline code content, resolves links and images.
 *
 * Returns `{ text, segments }` where each segment records how a span of the
 * original markdown maps to a span of stripped text. Use
 * `translateSpokenPos()` to map a position in `text` back to the original
 * markdown.
 */
export function toSpeakableText(markdown: string | null | undefined): SpeakableText {
  if (!markdown) return { text: '', segments: [] };
  try {
    const tokens = marked.lexer(markdown);
    const segments: TtsSegment[] = [];
    const parts: string[] = [];
    let origPos = 0;
    let strippedPos = 0;

    for (const token of tokens) {
      const step = topLevelStep(token, origPos, strippedPos);
      origPos += token.raw.length;
      if (!step) continue;
      segments.push(...step.segments);
      strippedPos += step.piece.length;
      parts.push(step.piece);
    }

    return finalizeSpeakableText(parts, segments);
  } catch {
    // Handled (§3.6): a lexer failure on malformed markdown falls back to
    // speaking the raw text rather than crashing.
    return { text: markdown, segments: [] };
  }
}

/**
 * Translate a character position in the stripped (speakable) text back to
 * the corresponding position in the original markdown string.
 */
export function translateSpokenPos(strippedPos: number, segments: readonly TtsSegment[] | undefined): number {
  if (!segments || segments.length === 0) return strippedPos;

  for (const seg of segments) {
    if (strippedPos <= seg.strippedStart + seg.strippedLen) {
      const offset = Math.max(0, strippedPos - seg.strippedStart);
      return seg.origStart + offset;
    }
  }

  // Beyond all segments — return end of last segment's original range.
  const last = segments[segments.length - 1];
  return last ? last.origStart + last.origLen : strippedPos;
}
