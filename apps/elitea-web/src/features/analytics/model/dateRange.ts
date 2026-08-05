/**
 * Pure date-range helpers extracted from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/AnalyticsContainer.jsx`
 * (spec §3.3: a slice's `model/` holds pure derived-state logic; this is the
 * one piece of `AnalyticsContainer`'s local state worth testing in
 * isolation from React).
 */

export interface DateRange {
  readonly from: Date;
  readonly to: Date;
}

/**
 * `AnalyticsContainer.jsx:76-80` (`handleDatePresetChange`) parity: `from`
 * is exactly `days` calendar days before `now` (via `setDate`, so it rides
 * over month/year boundaries the same way `Date.prototype.setDate` always
 * has), `to` is `now` itself.
 */
export function presetToDateRange(days: number, now: Date): DateRange {
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from, to: new Date(now) };
}

/** `AnalyticsContainer.jsx:56-57` parity: the wire format is always ISO 8601. */
export function toIsoRange(range: DateRange): { dateFrom: string; dateTo: string } {
  return { dateFrom: range.from.toISOString(), dateTo: range.to.toISOString() };
}
