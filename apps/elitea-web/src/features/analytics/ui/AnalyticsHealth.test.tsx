import { describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, buildEliteaTheme } from '@/shared/brand';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AnalyticsHealth } from './AnalyticsHealth';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

/**
 * `theme.vars.palette.*` resolves to a bare `var(--el-...)` reference, but
 * jsdom's `getComputedStyle` serializes that custom property back out with
 * its baked-in fallback (`var(--el-..., #hex)`) — so a direct
 * `toHaveStyle({ color: theme.vars.palette.* })` string-equality check never
 * matches even when the colour is correctly wired. Asserting the
 * custom-property *name* is present in the computed `color` is the same
 * pattern `RunStateDialog.status.test.tsx` uses for this exact reason.
 */
function expectColorVar(element: Element | null | undefined, varRef: string): void {
  const varName = /var\((--[\w-]+)/.exec(varRef)?.[1];
  if (!varName) throw new Error(`not a var() reference: ${varRef}`);
  expect(element).not.toBeNull();
  expect(getComputedStyle(element as Element).color).toContain(varName);
}

function expectNoColorVar(element: Element | null | undefined, varRef: string): void {
  const varName = /var\((--[\w-]+)/.exec(varRef)?.[1];
  if (!varName) throw new Error(`not a var() reference: ${varRef}`);
  expect(element).not.toBeNull();
  expect(getComputedStyle(element as Element).color).not.toContain(varName);
}

describe('AnalyticsHealth', () => {
  it('renders the empty state when no props are given (the real backend never sends `health` today)', () => {
    const { getByText } = renderWithTheme(<AnalyticsHealth />);
    expect(getByText('No health data available.')).toBeInTheDocument();
  });

  it('renders the empty state for an explicitly empty health array', () => {
    const { getByText } = renderWithTheme(
      <AnalyticsHealth
        health={[]}
        dailyActivity={[]}
      />,
    );
    expect(getByText('No health data available.')).toBeInTheDocument();
  });

  it('renders the health-by-event-type table when health rows are present', () => {
    const { getByText, queryByText } = renderWithTheme(
      <AnalyticsHealth
        health={[{ event_type: 'api', total: 100, errors: 5, error_rate: 0.05, avg_duration_ms: 250 }]}
        dailyActivity={[]}
      />,
    );
    expect(queryByText('No health data available.')).not.toBeInTheDocument();
    expect(getByText('Health by Event Type')).toBeInTheDocument();
    expect(getByText('api')).toBeInTheDocument();
    expect(getByText('100')).toBeInTheDocument();
    expect(getByText('5')).toBeInTheDocument();
    expect(getByText('5.0%')).toBeInTheDocument();
    expect(getByText('250ms')).toBeInTheDocument();
  });

  it('renders a nonzero error_rate fraction scaled to a percentage, not the raw fraction (regression)', () => {
    const { getByText, queryByText } = renderWithTheme(
      <AnalyticsHealth
        health={[{ event_type: 'llm', total: 10, errors: 2, error_rate: 0.2, avg_duration_ms: 900 }]}
        dailyActivity={[]}
      />,
    );
    // A 0.2 fraction is a genuine 20% error rate — must render "20.0%", not
    // the raw fraction ("0.2%") and not an unscaled-but-truncated "20%".
    expect(getByText('20.0%')).toBeInTheDocument();
    expect(queryByText('0.2%')).not.toBeInTheDocument();
  });

  it('colours the errors cell when errors are above zero, and the error-rate cell when the rate exceeds 5%', () => {
    const { getByText } = renderWithTheme(
      <AnalyticsHealth
        health={[{ event_type: 'llm', total: 10, errors: 2, error_rate: 0.2, avg_duration_ms: 900 }]}
        dailyActivity={[]}
      />,
    );
    expectColorVar(getByText('2'), theme.vars.palette.status.rejected);
    expectColorVar(getByText('20.0%'), theme.vars.palette.status.rejected);
  });

  it('does not colour the error-rate cell when the rate is exactly at the 5% threshold (strictly-greater-than)', () => {
    const { getByText } = renderWithTheme(
      <AnalyticsHealth
        health={[{ event_type: 'api', total: 100, errors: 0, error_rate: 0.05, avg_duration_ms: 250 }]}
        dailyActivity={[]}
      />,
    );
    expectNoColorVar(getByText('5.0%'), theme.vars.palette.status.rejected);
    expectNoColorVar(getByText('0'), theme.vars.palette.status.rejected);
  });

  it('renders the requests-vs-errors chart title only when dailyActivity has points', () => {
    const { getByText, queryByText } = renderWithTheme(
      <AnalyticsHealth
        health={[{ event_type: 'api', total: 1, errors: 0, error_rate: 0, avg_duration_ms: 10 }]}
        dailyActivity={[{ date: '2026-07-20', events: 10, errors: 1 }]}
      />,
    );
    expect(getByText('Requests vs Errors')).toBeInTheDocument();
    expect(queryByText('Requests vs Errors')).toBeInTheDocument();
  });

  it('omits the chart when dailyActivity is empty even with health rows present', () => {
    const { queryByText } = renderWithTheme(
      <AnalyticsHealth
        health={[{ event_type: 'api', total: 1, errors: 0, error_rate: 0, avg_duration_ms: 10 }]}
        dailyActivity={[]}
      />,
    );
    expect(queryByText('Requests vs Errors')).not.toBeInTheDocument();
  });

  it('falls back to a default dot colour for an unknown event_type', () => {
    const { getByText } = renderWithTheme(
      <AnalyticsHealth
        health={[{ event_type: 'unknown_type', total: 1, errors: 0, error_rate: 0, avg_duration_ms: 10 }]}
        dailyActivity={[]}
      />,
    );
    expect(getByText('unknown_type')).toBeInTheDocument();
  });
});
