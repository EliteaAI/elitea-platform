/**
 * Block-token → speakable-text conversion, split out of `ttsHelpers.ts`
 * (`tts.helpers.js:262-333` in the baseline) — same table-dispatch
 * rationale as `ttsInline.helpers.ts`'s own module doc.
 */
import type { Token, Tokens } from 'marked';

import { inlineText } from './ttsInline.helpers';
import type { TtsSegment } from './ttsHelpers.types';
import { codeBlockPlaceholder, ordinalFor, stripEmoji } from './ttsShared.helpers';

type BlockTextHandler = (token: Token) => string;

function listBlockText(token: Token): string {
  const list = token as Tokens.List;
  const items = list.items;
  if (list.ordered) {
    // Short ordered list → ordinal prefixes.
    return items.map((item, i) => `${ordinalFor(i)}, ${blockText(item.tokens).trim()}`).join('. ') + '.\n';
  }
  // Unordered list → items separated by a sentence pause.
  return items.map((item) => blockText(item.tokens).trim()).join('. ') + '.\n';
}

function textBlockText(token: Token): string {
  const t = token as Tokens.Text;
  return t.tokens && t.tokens.length > 0 ? inlineText(t.tokens) : stripEmoji(t.text ?? t.raw ?? '');
}

const BLOCK_HANDLERS: Readonly<Record<string, BlockTextHandler>> = {
  paragraph: (token) => inlineText((token as Tokens.Paragraph).tokens) + '\n',
  heading: (token) => inlineText((token as Tokens.Heading).tokens) + '\n',
  text: textBlockText,
  list: listBlockText,
  list_item: (token) => blockText((token as Tokens.ListItem).tokens),
  blockquote: (token) => blockText((token as Tokens.Blockquote).tokens),
  space: () => '',
  code: (token) => codeBlockPlaceholder((token as Tokens.Code).lang) + '\n',
  table: () => 'A table has been included. Please review it on screen.\n',
  html: () => '',
};

/**
 * Extract speakable plain text from a block token array.
 *
 * - code   : categorised placeholder (code / data / diagram)
 * - table  : placeholder
 * - list   : ordered short lists get ordinal prefixes; long lists get a count summary
 * - html   : silently dropped
 * - other  : any block type not in {@link BLOCK_HANDLERS} (e.g. `hr`, `def`)
 *            is silently dropped too — old-app parity
 *            (`tts.helpers.js`'s `blockText` switch `default: return
 *            token.text ?? '';`, and an `hr`/`def` token has no `.text`
 *            field, so that default resolves to `''`). Deliberately NOT
 *            `genericTokenText` (which falls back to `token.raw` and would
 *            speak the literal markdown, e.g. `'---'`, for these types).
 */
export function blockText(tokens: readonly Token[] | undefined): string {
  if (!tokens || tokens.length === 0) return '';
  return tokens.map((token) => (BLOCK_HANDLERS[token.type] ?? (() => ''))(token)).join('');
}

/**
 * Build per-item segments for a list token so `translateSpokenPos` can
 * highlight each list item individually as TTS reads through it.
 */
export function listSegments(listToken: Tokens.List, tokenOrigStart: number, strippedBase: number): { text: string; segments: TtsSegment[] } {
  const items = listToken.items;
  const itemTexts: string[] = [];
  const segments: TtsSegment[] = [];
  let itemOrigStart = tokenOrigStart;
  let strippedOffset = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const prefix = listToken.ordered ? `${ordinalFor(i)}, ` : '';
    const itemContent = blockText(item.tokens).trim();
    const itemText = prefix + itemContent;

    segments.push({
      origStart: itemOrigStart,
      origLen: item.raw.length,
      strippedStart: strippedBase + strippedOffset,
      strippedLen: itemText.length,
    });

    itemTexts.push(itemText);
    // Each item is followed by ". " (separator) or ".\n" (terminator) — both 2 chars.
    strippedOffset += itemText.length + 2;
    itemOrigStart += item.raw.length;
  }

  return { text: itemTexts.join('. ') + '.\n', segments };
}
