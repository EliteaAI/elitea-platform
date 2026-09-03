/**
 * Where the previewer's first pack comes from (ADR-0024 WP9, decision 9).
 *
 * The page opens from disk, so it cannot ask a server for anything. Its
 * initial pack is therefore read from an inline
 * `<script type="application/json" id="brand-pack">` element the exporter
 * fills at export time; when that element is absent or empty, or its content
 * fails validation, the page starts from the compiled `DEFAULT_BRAND_PACK`
 * and says so.
 *
 * `parseBrandPack` from `shared/brand` is NOT used here on purpose: it
 * degrades to the default pack and logs, which is right for the app shell
 * and wrong for a tool whose job is to show a designer WHY a pack was
 * refused. This module keeps every zod issue verbatim.
 */
import { BrandPack, DEFAULT_BRAND_PACK, buildEliteaTheme } from '@/shared/brand';

/** The id of the inline element the exporter fills. */
export const INLINE_PACK_ELEMENT_ID = 'brand-pack';

export type PackValidation =
  | { readonly ok: true; readonly pack: BrandPack }
  | { readonly ok: false; readonly issues: readonly string[] };

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Schema validation plus the trial build `channelC.ts` explains: the schemes
 * are open records, so a pack can be schema-valid and still fail inside
 * `toMuiPalette`. Both failures come back as readable issues.
 */
export function validateBrandPack(candidate: unknown): PackValidation {
  const parsed = BrandPack.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => {
        const path = issue.path.map(String).join('.');
        return `${path === '' ? '$' : path}: ${issue.message}`;
      }),
    };
  }
  try {
    buildEliteaTheme(parsed.data);
  } catch (cause) {
    return { ok: false, issues: [`cannot be built into a theme: ${errorMessage(cause)}`] };
  }
  return { ok: true, pack: parsed.data };
}

/** `validateBrandPack` over raw JSON text, with a JSON syntax error as an issue too. */
export function parseBrandPackText(text: string): PackValidation {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch (cause) {
    return { ok: false, issues: [`not valid JSON: ${errorMessage(cause)}`] };
  }
  return validateBrandPack(candidate);
}

export type PackSource = 'inline' | 'default';

export interface BootstrapResult {
  readonly source: PackSource;
  readonly pack: BrandPack;
  /** Why an inline pack was refused; empty when it was accepted or absent. */
  readonly issues: readonly string[];
}

/** Reads the inline element. See the module header for the three outcomes. */
export function readInlineBrandPack(doc: Pick<Document, 'getElementById'>): BootstrapResult {
  const element = doc.getElementById(INLINE_PACK_ELEMENT_ID);
  const text = element?.getAttribute('type') === 'application/json' ? (element.textContent ?? '').trim() : '';
  if (text === '') return { source: 'default', pack: DEFAULT_BRAND_PACK, issues: [] };
  const result = parseBrandPackText(text);
  if (result.ok) return { source: 'inline', pack: result.pack, issues: [] };
  return { source: 'default', pack: DEFAULT_BRAND_PACK, issues: result.issues };
}
