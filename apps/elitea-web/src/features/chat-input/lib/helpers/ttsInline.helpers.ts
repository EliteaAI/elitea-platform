/**
 * Inline-token → speakable-text conversion, split out of `ttsHelpers.ts`
 * (`tts.helpers.js:64-260` in the baseline) to stay under the §3.5
 * 400-line/complexity-12 budgets. Dispatches on `token.type` through a
 * lookup table (`INLINE_HANDLERS`/`INLINE_SEGMENT_HANDLERS`) rather than a
 * long `switch` — a switch with this many cases is itself a complexity-12+
 * violation regardless of how small each case body is; a table lookup is
 * O(1) branches for the dispatcher, with each per-type handler function
 * independently simple.
 */
import type { Token, Tokens } from 'marked';

import type { TtsSegment } from './ttsHelpers.types';
import { genericTokenText, isFilePath, isUrl, stripEmoji } from './ttsShared.helpers';

// ─── inlineText — plain speakable string, no position tracking ──────────────

type InlineTextHandler = (token: Token) => string;

function textInline(token: Token): string {
  const t = token as Tokens.Text;
  return stripEmoji(t.tokens && t.tokens.length > 0 ? inlineText(t.tokens) : (t.text ?? t.raw ?? ''));
}

function emphasisInline(token: Token): string {
  return inlineText((token as Tokens.Em | Tokens.Strong).tokens);
}

function linkInline(token: Token): string {
  const link = token as Tokens.Link;
  const href = link.href ?? '';
  const text = inlineText(link.tokens ?? []);
  if (isUrl(href)) {
    // Replace raw URLs; keep descriptive link text.
    return !text || text === href || isUrl(text) ? 'the link' : text;
  }
  if (isFilePath(href)) {
    return !text || text === href ? 'the file path' : text;
  }
  return text || href;
}

function imageInline(token: Token): string {
  const image = token as Tokens.Image;
  const alt = stripEmoji(image.text ?? '').trim();
  return alt ? `an image showing ${alt}` : '';
}

const INLINE_HANDLERS: Readonly<Record<string, InlineTextHandler>> = {
  text: textInline,
  em: emphasisInline,
  strong: emphasisInline,
  // Not a real `marked` token (see `ttsHelpers.ts`'s module doc) — kept for
  // byte-for-byte parity with the baseline's dead-but-harmless case.
  strong_em: emphasisInline,
  link: linkInline,
  image: imageInline,
  escape: (token) => (token as Tokens.Escape).text ?? '',
  br: () => '\n',
  codespan: (token) => (token as Tokens.Codespan).text ?? '',
};

/** Fallback for any inline token type not in {@link INLINE_HANDLERS} (e.g. GFM `del`/strikethrough, inline `html`) — old-app parity (`tts.helpers.js`'s `inlineText` switch `default: return stripEmoji(token.text ?? token.raw ?? '');`), same scoping as the position-tracking sibling {@link defaultSegmentStep} below (`stripEmoji` wraps only the fallback, not every handler — handlers that already apply it, like {@link textInline}, would otherwise be double-wrapped for no benefit, and handlers that deliberately don't, like {@link linkInline}'s literal href/text passthrough, would have their output altered). */
function defaultInlineText(token: Token): string {
  return stripEmoji(genericTokenText(token));
}

/**
 * Extract speakable plain text from an array of inline tokens.
 *
 * - codespan  : read content (drop backticks)
 * - link      : URL hrefs → "the link", file-path hrefs → "the file path",
 *               descriptive link text → keep the text
 * - image     : read alt text as "an image showing <alt>"
 * - emoji     : functional emoji → spoken word; decorative → stripped
 */
export function inlineText(tokens: readonly Token[] | undefined): string {
  if (!tokens || tokens.length === 0) return '';
  return tokens.map((token) => (INLINE_HANDLERS[token.type] ?? defaultInlineText)(token)).join('');
}

// ─── inlineTextSegments — same conversion, plus orig↔stripped position map ──

interface InlineStep {
  readonly text: string;
  readonly segments: readonly TtsSegment[];
}

type InlineSegmentHandler = (token: Token, origStart: number, strippedStart: number) => InlineStep;

function leafStep(piece: string, origStart: number, origLen: number, strippedStart: number): InlineStep {
  if (!piece) return { text: '', segments: [] };
  return { text: piece, segments: [{ origStart, origLen, strippedStart, strippedLen: piece.length }] };
}

function recurseStep(tokens: readonly Token[] | undefined, origStart: number, strippedStart: number): InlineStep {
  const inner = inlineTextSegments(tokens, origStart, strippedStart);
  return { text: inner.text, segments: inner.segments };
}

function textSegmentStep(token: Token, origStart: number, strippedStart: number): InlineStep {
  const t = token as Tokens.Text;
  if (t.tokens && t.tokens.length > 0) return recurseStep(t.tokens, origStart, strippedStart);
  return leafStep(stripEmoji(t.text ?? t.raw ?? ''), origStart, token.raw.length, strippedStart);
}

/** Skips the opening delimiter (`*`/`**`/`***`) so inner content maps 1:1. */
function emphasisSegmentStep(token: Token, origStart: number, strippedStart: number): InlineStep {
  const delimLen = token.type === 'strong_em' ? 3 : token.type === 'strong' ? 2 : 1;
  return recurseStep((token as Tokens.Em | Tokens.Strong).tokens, origStart + delimLen, strippedStart);
}

function linkSegmentStep(token: Token, origStart: number, strippedStart: number): InlineStep {
  const link = token as Tokens.Link;
  const href = link.href ?? '';
  const linkTokens = link.tokens ?? [];
  const textFromTokens = inlineText(linkTokens);
  if (isUrl(href)) {
    const piece = !textFromTokens || textFromTokens === href || isUrl(textFromTokens) ? 'the link' : textFromTokens;
    return leafStep(piece, origStart, token.raw.length, strippedStart);
  }
  if (isFilePath(href)) {
    const piece = !textFromTokens || textFromTokens === href ? 'the file path' : textFromTokens;
    return leafStep(piece, origStart, token.raw.length, strippedStart);
  }
  // Descriptive link — fine-grained segments for the display text (starts after '[').
  return recurseStep(linkTokens, origStart + 1, strippedStart);
}

function imageSegmentStep(token: Token, origStart: number, strippedStart: number): InlineStep {
  const image = token as Tokens.Image;
  const alt = stripEmoji(image.text ?? '').trim();
  return leafStep(alt ? `an image showing ${alt}` : '', origStart, token.raw.length, strippedStart);
}

const INLINE_SEGMENT_HANDLERS: Readonly<Record<string, InlineSegmentHandler>> = {
  text: textSegmentStep,
  em: emphasisSegmentStep,
  strong: emphasisSegmentStep,
  strong_em: emphasisSegmentStep,
  link: linkSegmentStep,
  image: imageSegmentStep,
  codespan: (token, origStart, strippedStart) => leafStep((token as Tokens.Codespan).text ?? '', origStart, token.raw.length, strippedStart),
  escape: (token, origStart, strippedStart) => leafStep((token as Tokens.Escape).text ?? '', origStart, token.raw.length, strippedStart),
  br: (token, origStart, strippedStart) => leafStep('\n', origStart, token.raw.length, strippedStart),
};

function defaultSegmentStep(token: Token, origStart: number, strippedStart: number): InlineStep {
  return leafStep(stripEmoji(genericTokenText(token)), origStart, token.raw.length, strippedStart);
}

/**
 * Like `inlineText` but also builds fine-grained segments so each text run
 * maps precisely to its position in the original markdown.
 *
 * `origBase`/`strippedBase` are the absolute start positions of `tokens` in
 * the original markdown / the stripped text respectively.
 */
export function inlineTextSegments(tokens: readonly Token[] | undefined, origBase: number, strippedBase: number): InlineStep {
  if (!tokens || tokens.length === 0) return { text: '', segments: [] };

  let origOffset = 0;
  let strippedOffset = 0;
  const segments: TtsSegment[] = [];
  const parts: string[] = [];

  for (const token of tokens) {
    const handler = INLINE_SEGMENT_HANDLERS[token.type] ?? defaultSegmentStep;
    const step = handler(token, origBase + origOffset, strippedBase + strippedOffset);
    segments.push(...step.segments);
    parts.push(step.text);
    strippedOffset += step.text.length;
    origOffset += token.raw.length;
  }

  return { text: parts.join(''), segments };
}
