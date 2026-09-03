/**
 * `@font-face` for the previewer (ADR-0024 WP9).
 *
 * `fontFaceStylesheet` emits one rule per face with the pack's own
 * same-origin path in `src:url(...)`, and refuses anything else — a
 * `blob:` URL included, which is right for the app and useless here, where
 * the font lives in memory. So the stylesheet is generated exactly as the
 * app would, and the `url()` of every face whose file was loaded is then
 * rewritten to the object URL. A face with no loaded file keeps its path and
 * falls through the family stack, as it would in the app.
 */
import { fontFaceStylesheet, type BrandPack } from '@/shared/brand';

import { fontUrlFor, type LoadedAssets } from './assets';

/** Matches the `src:url("…")` token `fontFaceRule` emits; the path never carries a quote. */
const FONT_SRC_RE = /src:url\("([^"]*)"\)/g;

/** Rewrites each face's source through `resolve`; an unresolved source is left as is. */
export function rewriteFontFaceSources(stylesheet: string, resolve: (url: string) => string | undefined): string {
  let out = '';
  let last = 0;
  for (const match of stylesheet.matchAll(FONT_SRC_RE)) {
    const url = match[1] ?? '';
    const replacement = resolve(url);
    out += stylesheet.slice(last, match.index);
    out += replacement === undefined ? match[0] : `src:url("${replacement}")`;
    last = match.index + match[0].length;
  }
  return out + stylesheet.slice(last);
}

/** The stylesheet the page injects: the pack's faces, sourced from memory where a file was loaded. */
export function previewFontStylesheet(pack: Pick<BrandPack, 'typography'>, assets: LoadedAssets): string {
  return rewriteFontFaceSources(fontFaceStylesheet(pack), (url) => fontUrlFor(url, assets));
}
