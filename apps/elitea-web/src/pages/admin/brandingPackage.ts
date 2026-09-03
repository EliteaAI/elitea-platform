/**
 * The branding package's presentation helpers (ADR-0024 WP9): how a report
 * from `POST /admin/branding/package/administration` is read and shown.
 *
 * Pure, so the page's rendering of a report is testable without MSW, and so
 * the one non-obvious reading — a refusal is a 400 WITH the report shape, not
 * an `{error}` envelope — lives in one function the API adapter calls.
 */
import type { BrandingPackageReport } from '@/shared/api/generated/model';

/** The report a refused import carries in its 400 body, when the body is one. */
export function parseBrandingPackageReport(body: unknown): BrandingPackageReport | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record['ok'] !== 'boolean' || !Array.isArray(record['problems'])) return undefined;
  const optional = (key: 'manifest' | 'version' | 'error'): Record<string, unknown> =>
    record[key] === undefined ? {} : { [key]: record[key] };
  return {
    ok: record['ok'],
    dry_run: record['dry_run'] === true,
    applied: record['applied'] === true,
    problems: record['problems'] as BrandingPackageReport['problems'],
    warnings: Array.isArray(record['warnings']) ? (record['warnings'] as string[]) : [],
    diff: Array.isArray(record['diff']) ? (record['diff'] as BrandingPackageReport['diff']) : [],
    ...optional('manifest'),
    ...optional('version'),
    ...optional('error'),
  };
}

/** Whether a section value means "inherit from the layer below": empty, 0, `[]` or `{}`. */
export function isInheritValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return value === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

const MAX_DIFF_VALUE_LENGTH = 80;

/**
 * One cell of the diff table: a scalar as itself, an array or object as short
 * JSON, and an inherit value as `inheritLabel`. Long values are cut with an
 * ellipsis — the table is for recognising a change, not reading a font list.
 */
export function formatDiffValue(value: unknown, inheritLabel: string): string {
  if (isInheritValue(value)) return inheritLabel;
  const text = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
  if (text === undefined) return inheritLabel;
  return text.length > MAX_DIFF_VALUE_LENGTH ? `${text.slice(0, MAX_DIFF_VALUE_LENGTH - 1)}…` : text;
}

const SHORT_DIGEST_LENGTH = 12;

/** The first twelve characters of a content digest — enough to tell versions apart on a screen. */
export function shortDigest(digest: string): string {
  return digest.length > SHORT_DIGEST_LENGTH ? digest.slice(0, SHORT_DIGEST_LENGTH) : digest;
}

const KIB = 1024;

/** `80 B`, `512.0 KiB`, `1.3 MiB` — the package cap is stated in MiB, so the unit matches. */
export function formatPackageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < KIB) return `${Math.round(bytes)} B`;
  if (bytes < KIB * KIB) return `${(bytes / KIB).toFixed(1)} KiB`;
  return `${(bytes / KIB / KIB).toFixed(1)} MiB`;
}

/** An ISO timestamp in the operator's locale, the raw text when it does not parse, a dash when absent. */
export function formatPackageTime(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** The sentence a refused report is summarised by: its own `error`, else the first problem. */
export function reportSummary(report: BrandingPackageReport): string | undefined {
  if (typeof report.error === 'string' && report.error !== '') return report.error;
  const first = report.problems[0];
  return first === undefined ? undefined : `${first.entry}: ${first.reason}`;
}
