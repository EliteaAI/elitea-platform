/**
 * Shared primitives for the `tts.helpers.js` port (`ttsHelpers.ts`/
 * `ttsInline.helpers.ts`/`ttsBlock.helpers.ts`) — emoji mapping, code-block
 * language classification, link/path detection, and list ordinals. Split
 * out purely to keep every file in this port under the §3.5 400-line/
 * complexity-12 budgets; no behavioral change from the single-file baseline.
 */
import type { Token } from 'marked';

// ─── Emoji handling ───────────────────────────────────────────────────────────

/** Functional emoji that carry meaning → spoken word. */
const EMOJI_MAP: Readonly<Record<string, string>> = {
  '✓': 'yes',
  '✔': 'yes',
  '☑': 'yes',
  '✅': 'yes',
  '✗': 'no',
  '✘': 'no',
  '✕': 'no',
  '❌': 'no',
  '⚠': 'warning',
  '⚠️': 'warning',
};

// Broad emoji Unicode ranges — decorative emoji are stripped silently.
// Variation selectors (️ etc.) are intentionally excluded to avoid the
// no-misleading-character-class lint rule; stripping the base code point is
// sufficient.
const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

export function stripEmoji(text: string): string {
  let s = text;
  for (const [ch, word] of Object.entries(EMOJI_MAP)) {
    if (s.includes(ch)) s = s.split(ch).join(word ? ` ${word} ` : ' ');
  }
  return s.replace(EMOJI_RE, '').replace(/ {2,}/g, ' ');
}

// ─── Code / data / diagram placeholders ──────────────────────────────────────

const DIAGRAM_LANGS = new Set(['mermaid', 'plantuml', 'graphviz', 'd2', 'flowchart', 'sequence', 'svg']);
const DATA_LANGS = new Set(['json', 'xml', 'yaml', 'yml', 'toml', 'csv', 'tsv']);

export function codeBlockPlaceholder(lang: string | undefined): string {
  const l = (lang ?? '').toLowerCase().trim();
  if (DIAGRAM_LANGS.has(l)) return 'A diagram has been included. Please review it on screen.';
  if (DATA_LANGS.has(l)) return 'Structured data has been included. Please review it on screen.';
  return 'A code example has been included. Please review it on screen.';
}

// ─── Link / path detection ────────────────────────────────────────────────────

export function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export function isFilePath(s: string): boolean {
  return /^[./\\]|^\w:[\\/]/.test(s);
}

// ─── List ordinals ────────────────────────────────────────────────────────────

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];

export function ordinalFor(index: number): string {
  return ORDINALS[index] ?? `Item ${index + 1}`;
}

// ─── Safe field reads off a loosely-typed marked token ───────────────────────

/**
 * `marked`'s `Tokens.Generic` (the catch-all member of its `Token` union)
 * types `text`/`raw` as `any`, which would otherwise leak `no-unsafe-*`
 * violations into every "unhandled token type" fallback below. Reading
 * through this narrow, explicitly-`unknown` local shape instead keeps the
 * fallback type-safe without asserting a wider (and wrong) shape onto an
 * arbitrary extension token.
 */
export function genericTokenText(token: Token): string {
  const withText = token as { text?: unknown };
  return typeof withText.text === 'string' ? withText.text : token.raw;
}
