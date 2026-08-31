import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { IndexingReportSummary } from './IndexingReportSummary';

describe('IndexingReportSummary', () => {
  it('renders nothing when the source carries no run information', () => {
    const { queryByTestId } = renderWithTheme(<IndexingReportSummary source={{ collection: 'my-index' }} />);
    expect(queryByTestId('indexing-report-summary')).toBeNull();
  });

  it('breaks a canonical report down by category, with sampled names and an overflow line', () => {
    const { getByTestId, getByText } = renderWithTheme(
      <IndexingReportSummary
        source={{
          report: {
            status: 'partly_indexed',
            totals: { indexed: 4, skipped: 7, unchanged: 2, total: 13 },
            categories: [
              { kind: 'indexed', count: 4, groups: [] },
              {
                kind: 'skipped',
                count: 7,
                groups: [
                  {
                    reason: 'filtered',
                    label: 'Excluded by configured filters',
                    count: 7,
                    items: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
                  },
                ],
              },
            ],
          },
        }}
      />,
    );
    expect(getByTestId('indexing-report-category-skipped')).toBeInTheDocument();
    // The headline text sits beside its icon in the same element, so match loosely.
    expect(getByText(/4 documents indexed/)).toBeInTheDocument();
    expect(getByText(/Excluded by configured filters/)).toBeInTheDocument();
    expect(getByText('… and 2 more')).toBeInTheDocument();
    // The unchanged tally is stripped from the "skipped" category, so it has
    // to be restated on its own line — otherwise it silently disappears.
    expect(getByTestId('indexing-report-unchanged')).toHaveTextContent('2 documents already indexed (unchanged)');
  });

  it('renders a pre-report row synthesised from the raw skipped blob', () => {
    const { getByText } = renderWithTheme(
      <IndexingReportSummary
        source={{ indexed: 5, skipped: { documents_skipped: { filtered_count: 2, filtered: ['x.md', 'y.md'] } } }}
      />,
    );
    expect(getByText(/5 documents indexed/)).toBeInTheDocument();
    expect(getByText(/2 documents skipped/)).toBeInTheDocument();
    expect(getByText('x.md')).toBeInTheDocument();
  });

  it('lists the run errors and how many more distinct ones there were', () => {
    const { getByTestId } = renderWithTheme(
      <IndexingReportSummary source={{ report: { status: 'error', totals: {}, errors: ['boom'], errors_total: 4 } }} />,
    );
    const errors = getByTestId('indexing-report-errors');
    expect(errors).toHaveTextContent('boom');
    expect(errors).toHaveTextContent('… and 3 more distinct errors');
  });
});
