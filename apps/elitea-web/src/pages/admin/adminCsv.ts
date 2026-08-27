/**
 * CSV primitives shared by the admin list exports (Users, Projects).
 *
 * The reference admin_ui writes .xlsx through SheetJS. This app carries no
 * spreadsheet dependency, and the package on npm under that name is a stale
 * 0.18.5 with unfixed advisories, so the exports are CSV — which Excel,
 * Numbers and Sheets all open directly. That is a deliberate FORMAT change
 * from the reference, not a missing feature.
 *
 * Three properties this module exists to guarantee, none of which a
 * "does a file download?" assertion can see:
 *
 *  - **RFC 4180 quoting.** A display name legitimately contains commas and
 *    quotes; unquoted, one such row shifts every later column.
 *  - **No formula injection.** A cell whose text begins `=`, `+`, `-`, `@` or
 *    a control character is executed as a formula by Excel on open. Names and
 *    project titles are attacker-controlled through SSO/SCIM and the product's
 *    own forms, so every such value is prefixed with an apostrophe (the sheet
 *    still SHOWS the original text).
 *  - **A UTF-8 BOM on the downloaded bytes.** Without it Excel decodes the
 *    file as the local ANSI code page and every non-ASCII name arrives
 *    mangled.
 */
import { triggerBlobDownload } from '@/shared/lib/download';

const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** RFC 4180 field + the leading-apostrophe formula guard described above. */
export function toCsvField(value: string): string {
  const guarded = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/**
 * Header + body → a CSV document. CRLF line endings (RFC 4180, and what Excel
 * expects); `downloadCsv` adds the BOM.
 */
export function toCsvDocument(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, ...rows].map((cells) => cells.map(toCsvField).join(',')).join('\r\n');
}

/** `csv` → a BOM-prefixed UTF-8 blob the browser saves as `filename`. */
export function downloadCsv(filename: string, csv: string): void {
  triggerBlobDownload(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), filename);
}

/**
 * Page size for an export walk.
 *
 * 100 is not a taste choice: `paginationParams`
 * (services/elitea-main/internal/api/v2/admin/handler.go) honours a supplied
 * `limit` only when `0 < v <= 100`, and SILENTLY falls back to its default of
 * 20 otherwise. A larger number here does not fetch more — it fetches 20 and
 * makes the walk below mistake that for the last page.
 */
const CSV_EXPORT_PAGE_SIZE = 100;

/** Stops a pathological response (a server that ignores `offset`) from looping forever. */
const CSV_EXPORT_MAX_ROWS = 100_000;

export interface AllPagesResult<T> {
  readonly rows: readonly T[];
  /**
   * True when the walk stopped at `CSV_EXPORT_MAX_ROWS` with rows still
   * unread. The caller MUST surface this: a truncated export is a short file
   * that looks exactly like a complete one.
   */
  readonly truncated: boolean;
}

/**
 * Every row a filter selects, walked page by page through `fetchPage`.
 *
 * `offset` advances by the number of rows actually RETURNED, never by the
 * requested page size, and the walk ends on an empty page rather than on a
 * short one. Both matter because a server may serve fewer rows than asked:
 * advancing by the request would skip the difference, and treating a short
 * page as the end would stop the walk on the first one.
 */
export async function fetchAllPages<T>(
  fetchPage: (limit: number, offset: number) => Promise<{ readonly rows: readonly T[]; readonly total: number }>,
): Promise<AllPagesResult<T>> {
  const collected: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(CSV_EXPORT_PAGE_SIZE, offset);
    if (page.rows.length === 0) return { rows: collected, truncated: false };
    collected.push(...page.rows);
    offset += page.rows.length;
    if (collected.length >= page.total) return { rows: collected, truncated: false };
    if (collected.length >= CSV_EXPORT_MAX_ROWS) return { rows: collected, truncated: true };
  }
}
