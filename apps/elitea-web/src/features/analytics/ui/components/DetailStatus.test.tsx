import { describe, expect, it } from 'vitest';

import { EliteaApiError } from '@/shared/api/generated/mutator';
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

  /**
   * The two failures are not the same event and must not read the same. A user
   * shown "Failed to load analytics data." on a tab whose figures no producer
   * exists for has two honest responses available — file a bug that will be
   * closed as working-as-intended, or keep reloading a page that will never
   * fill in — and neither is one this screen should cause.
   */
  it('says the feature is absent — with the reason — for a 501 no_data_source', () => {
    const error = new EliteaApiError({
      kind: 'http',
      status: 501,
      url: 'https://example.test/api/v2/elitea_core/analytics_tools/prompt_lib/7',
      body: {
        error: 'analytics is not available on this deployment',
        code: 'no_data_source',
        detail: 'analytics: no data source: tool analytics: no toolkit_id',
      },
    });
    const { getByText, queryByText } = renderWithTheme(<AnalyticsLoadError error={error} />);
    expect(getByText('Not available on this deployment')).toBeVisible();
    // The server's own words, not a paraphrase this component would have to
    // keep in step with a repository it cannot see.
    expect(getByText('analytics: no data source: tool analytics: no toolkit_id')).toBeVisible();
    expect(queryByText('Failed to load analytics data.')).not.toBeInTheDocument();
  });

  /** A genuine query failure keeps the retryable wording. */
  it('keeps the generic message for a 500', () => {
    const error = new EliteaApiError({
      kind: 'http',
      status: 500,
      url: 'https://example.test/api/v2/elitea_core/analytics/prompt_lib/7',
      body: { error: 'failed to query analytics', code: 'query_failed' },
    });
    const { getByText, queryByText } = renderWithTheme(<AnalyticsLoadError error={error} />);
    expect(getByText('Failed to load analytics data.')).toBeVisible();
    expect(queryByText('Not available on this deployment')).not.toBeInTheDocument();
  });
});
