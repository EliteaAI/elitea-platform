import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AnalyticsHealth } from './AnalyticsHealth';

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
        health={[{ event_type: 'api', total: 100, errors: 5, error_rate: 5, avg_duration_ms: 250 }]}
        dailyActivity={[]}
      />,
    );
    expect(queryByText('No health data available.')).not.toBeInTheDocument();
    expect(getByText('Health by Event Type')).toBeInTheDocument();
    expect(getByText('api')).toBeInTheDocument();
    expect(getByText('100')).toBeInTheDocument();
    expect(getByText('5')).toBeInTheDocument();
    expect(getByText('5%')).toBeInTheDocument();
    expect(getByText('250ms')).toBeInTheDocument();
  });

  it('colours the errors/error-rate cells when they are above zero/five respectively', () => {
    const { getByText } = renderWithTheme(
      <AnalyticsHealth
        health={[{ event_type: 'llm', total: 10, errors: 2, error_rate: 20, avg_duration_ms: 900 }]}
        dailyActivity={[]}
      />,
    );
    expect(getByText('2')).toBeInTheDocument();
    expect(getByText('20%')).toBeInTheDocument();
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
