import { describe, expect, it } from 'vitest';

import type { AnalyticsHealth as AnalyticsHealthData } from '@/shared/api/generated/model';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AnalyticsHealth } from './AnalyticsHealth';

/**
 * A window with traffic, some of which failed.
 *
 * The previous revision of this file fixtured `{event_type, total, errors,
 * error_rate, avg_duration_ms}` rows — a shape no response has ever carried.
 * Every one of its cases passed, because the component read those fields
 * through loose readers that answer `0` for anything missing, and because
 * nothing in the suite could see that the tab never received a `health` prop at
 * all. That is the value of the typed shape: both defects are now compile
 * errors rather than green tests.
 */
const HEALTH: AnalyticsHealthData = {
  requests: 120,
  errors: 12,
  error_rate: 10,
  by_error_code: [
    { error_code: 'upstream_error', requests: 8 },
    { error_code: 'budget_exceeded', requests: 4 },
  ],
  error_codes_truncated: false,
  by_model: [
    {
      provider: 'openai',
      model: 'gpt-4o',
      streaming: false,
      requests: 80,
      errors: 8,
      error_rate: 10,
      avg_duration_ms: 150,
      p95_duration_ms: 420,
    },
    {
      provider: 'openai',
      model: 'gpt-4o',
      streaming: true,
      requests: 40,
      errors: 4,
      error_rate: 10,
      avg_duration_ms: 7000,
      p95_duration_ms: 9500,
    },
  ],
  daily: [
    { date: '2026-08-18', requests: 70, errors: 5 },
    { date: '2026-08-19', requests: 50, errors: 7 },
  ],
};

describe('AnalyticsHealth', () => {
  /**
   * ABSENT is the only state that means "no data". An idle project gets a
   * health object with zero totals, which is a real measurement.
   */
  it('shows the empty state only when no health block was returned', () => {
    const { getByText } = renderWithTheme(<AnalyticsHealth health={undefined} />);
    expect(getByText('No health data available.')).toBeInTheDocument();
  });

  it('reports real zeros for a project with no traffic, not the empty state', () => {
    const idle: AnalyticsHealthData = {
      requests: 0,
      errors: 0,
      error_rate: 0,
      by_error_code: [],
      error_codes_truncated: false,
      by_model: [],
      daily: [],
    };
    const { getByText, queryByText } = renderWithTheme(<AnalyticsHealth health={idle} />);
    expect(queryByText('No health data available.')).not.toBeInTheDocument();
    expect(getByText('REQUESTS')).toBeInTheDocument();
    expect(getByText('0.0%')).toBeInTheDocument();
  });

  it('renders the totals from the response', () => {
    const { getByText, getAllByText } = renderWithTheme(<AnalyticsHealth health={HEALTH} />);
    expect(getByText('120')).toBeInTheDocument();
    expect(getByText('12')).toBeInTheDocument();
    // The headline rate and both per-model rates read 10.0% in this fixture —
    // scoped to the KPI tile rather than the document, so the assertion is
    // about the tile it names.
    expect(getByText('ERROR RATE').parentElement).toHaveTextContent('10.0%');
    expect(getAllByText('10.0%')).toHaveLength(3);
  });

  /**
   * The failure breakdown is the whole reason this tab can exist: the billing
   * ledger is written from a delta that rides only a BILLED request, so it
   * holds no refusals and no upstream failures at all.
   */
  it('lists the gateway\'s own failure classifications, most frequent first', () => {
    const { getAllByText, getByText } = renderWithTheme(<AnalyticsHealth health={HEALTH} />);
    expect(getByText('Failures by Classification')).toBeInTheDocument();
    expect(getByText('upstream_error')).toBeInTheDocument();
    expect(getByText('budget_exceeded')).toBeInTheDocument();
    expect(getAllByText('8').length).toBeGreaterThan(0);
  });

  /**
   * The two rows for one model are not duplicates — they are the two response
   * kinds, which 0099 says must never be averaged together because a streamed
   * duration is the whole stream. Without the Response column the table would
   * read as a rendering bug.
   */
  it('shows streamed and buffered as separate rows with their own latencies', () => {
    const { getAllByText, getByText } = renderWithTheme(<AnalyticsHealth health={HEALTH} />);
    expect(getAllByText('gpt-4o')).toHaveLength(2);
    expect(getByText('buffered')).toBeInTheDocument();
    expect(getByText('streamed')).toBeInTheDocument();
    // 150ms buffered against 7.0s streamed — the merged mean (2433ms) appears
    // nowhere, and could not, because the two rows are keyed apart.
    expect(getByText('150ms')).toBeInTheDocument();
    expect(getByText('7.0s')).toBeInTheDocument();
  });

  /** The tail, alongside the mean it would otherwise hide. */
  it('reports p95 as well as the average', () => {
    const { getByText } = renderWithTheme(<AnalyticsHealth health={HEALTH} />);
    expect(getByText('420ms')).toBeInTheDocument();
    expect(getByText('9.5s')).toBeInTheDocument();
  });

  it('renders the trend chart when there are daily points', () => {
    const { container } = renderWithTheme(<AnalyticsHealth health={HEALTH} />);
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });

  /**
   * A table with no rows renders nothing rather than headers over emptiness —
   * a header row above no data reads as a failed load.
   */
  it('omits a table whose breakdown is empty', () => {
    const noBreakdown: AnalyticsHealthData = { ...HEALTH, by_error_code: [], by_model: [] };
    const { queryByText } = renderWithTheme(<AnalyticsHealth health={noBreakdown} />);
    expect(queryByText('Failures by Classification')).not.toBeInTheDocument();
    expect(queryByText('Health by Model')).not.toBeInTheDocument();
  });
});
