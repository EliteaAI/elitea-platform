/**
 * Pure formatting and lookup helpers for the admin Audit Trail page (unit A14).
 *
 * Kept out of the components for the reason `features/analytics/model` is:
 * these are input → output functions with nothing React-shaped about them, and
 * the duration-band table below is a CONTRACT with the server rather than a
 * styling choice, so it deserves to be readable and testable on its own.
 *
 * Colour values live in `./auditPalette.json`, not as `.ts` literals here —
 * `elitea/no-raw-color` (R-T1) walks every string literal in a linted file, and
 * the token package is the only exemption. `features/analytics/lib/constants.ts`
 * uses the same JSON-sidecar arrangement for its own categorical chart palette.
 */
import auditPalette from './auditPalette.json';

/**
 * The duration bands, in the order the server emits them (slowest first), with
 * the millisecond bounds each one means.
 *
 * These labels are a CONTRACT: the server sends them as the heatmap's series
 * ids, and clicking a cell sends the matching `[min, max)` back as
 * `duration_min` / `duration_max`. `max: null` is unbounded. They must stay in
 * step with `heatmapBands` / `bandExpression` in
 * `services/elitea-main/internal/api/v2/eliteacore/audit_query.go`.
 */
export interface DurationBand {
  readonly label: string;
  readonly min: number;
  readonly max: number | null;
}

const DURATION_BANDS: readonly DurationBand[] = [
  { label: '>10s', min: 10000, max: null },
  { label: '1-10s', min: 1000, max: 10000 },
  { label: '100ms-1s', min: 100, max: 1000 },
  { label: '10-100ms', min: 10, max: 100 },
  { label: '<10ms', min: 0, max: 10 },
];

/** The band a heatmap series id names, or `undefined` for an unknown label. */
export function findDurationBand(label: string): DurationBand | undefined {
  return DURATION_BANDS.find((band) => band.label === label);
}

/** The categorical colour for an event type; unknown types get a neutral grey. */
export function eventTypeColor(eventType: string): string {
  const colors: Record<string, string> = auditPalette.eventTypeColors;
  return colors[eventType] ?? auditPalette.unknownEventTypeColor;
}

/**
 * Human duration. `null` renders as a dash rather than as `0ms`: "no duration
 * was recorded" and "it took no time" are different facts, and the server
 * deliberately excludes unmeasured spans from the heatmap for the same reason.
 */
export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return '—';
  if (milliseconds < 1) return '<1ms';
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

/** Local-time timestamp for a table cell, or a dash when there is none. */
export function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * A heatmap column label. The server sends bucket starts as epoch SECONDS
 * precisely so the client can render them in the viewer's own timezone; a
 * pre-formatted server-side label would be in the server's.
 *
 * The shape follows the bucket width: day-wide buckets need no clock, and a
 * range spanning more than a day needs the date as well as the clock.
 */
export function formatBucket(epochSeconds: number, intervalSeconds: number, rangeSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  if (intervalSeconds >= 86400) return day;
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return rangeSeconds > 86400 ? `${day} ${time}` : time;
}

/**
 * The label for a span/trace row: the action, with the tool or model that ran
 * it appended when there is one. Matches the reference page's `action [tool]`.
 */
export function formatAction(row: {
  readonly action?: string | null;
  readonly tool_name?: string | null;
  readonly model_name?: string | null;
}): string {
  const action = row.action ?? '—';
  const qualifier = row.tool_name ?? row.model_name;
  return qualifier ? `${action} [${qualifier}]` : action;
}

/* ── date presets ──────────────────────────────────────────────────────── */

export interface DateRange {
  readonly from: Date;
  readonly to: Date;
}

/**
 * The quick ranges above the filter bar.
 *
 * NOT reused from `features/analytics/lib/constants.ts`'s `DATE_FILTER_PRESETS`:
 * those are four whole-day windows expressed as a day count ("Last 7d" = now
 * minus 7×24h), while these mix rolling clock windows (30m, 1h) with
 * calendar-day windows snapped to local midnight (Today, Yesterday). Sharing
 * one list would have to drop one of the two behaviours.
 */
export interface DatePreset {
  readonly label: string;
  readonly toRange: (now: Date) => DateRange;
}

function startOfDay(now: Date, dayOffset: number): Date {
  const start = new Date(now);
  start.setDate(start.getDate() + dayOffset);
  start.setHours(0, 0, 0, 0);
  return start;
}

function endOfDay(now: Date, dayOffset: number): Date {
  const end = new Date(now);
  end.setDate(end.getDate() + dayOffset);
  end.setHours(23, 59, 59, 999);
  return end;
}

function rollingMinutes(minutes: number): (now: Date) => DateRange {
  return (now) => ({ from: new Date(now.getTime() - minutes * 60_000), to: new Date(now) });
}

export const DATE_PRESETS: readonly DatePreset[] = [
  { label: '30m', toRange: rollingMinutes(30) },
  { label: '1h', toRange: rollingMinutes(60) },
  { label: 'Today', toRange: (now) => ({ from: startOfDay(now, 0), to: endOfDay(now, 0) }) },
  { label: 'Yesterday', toRange: (now) => ({ from: startOfDay(now, -1), to: endOfDay(now, -1) }) },
  { label: '7d', toRange: (now) => ({ from: startOfDay(now, -7), to: endOfDay(now, 0) }) },
  { label: '30d', toRange: (now) => ({ from: startOfDay(now, -30), to: endOfDay(now, 0) }) },
];

/** The preset the page opens on. */
export const DEFAULT_PRESET = 'Today';

export function presetRange(label: string, now: Date): DateRange | undefined {
  return DATE_PRESETS.find((preset) => preset.label === label)?.toRange(now);
}
