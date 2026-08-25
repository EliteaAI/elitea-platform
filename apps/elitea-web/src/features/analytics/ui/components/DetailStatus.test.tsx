import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AnalyticsLoadError, DetailEmpty, DetailLoading } from './DetailStatus';

describe('DetailLoading', () => {
  it('renders a progress indicator', () => {
    const { getByRole } = renderWithTheme(<DetailLoading />);
    expect(getByRole('progressbar')).toBeInTheDocument();
  });
});

describe('DetailEmpty', () => {
  it('renders the "no data found" message', () => {
    const { getByText } = renderWithTheme(<DetailEmpty />);
    expect(getByText('No data found.')).toBeInTheDocument();
  });
});

describe('AnalyticsLoadError', () => {
  // The exact string matters beyond this unit: `e2e/journeys/settings/
  // settings.analytics.spec.ts` (J24d/J24e) matches it exactly.
  it('renders the shared load-failure message, distinct from the empty state', () => {
    const { getByText, queryByText } = renderWithTheme(<AnalyticsLoadError />);
    expect(getByText('Failed to load analytics data.')).toBeVisible();
    expect(queryByText('No data found.')).not.toBeInTheDocument();
  });
});
