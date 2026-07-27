import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { GUIDE_SECTIONS } from '../lib/constants';
import { AnalyticsGuide } from './AnalyticsGuide';

describe('AnalyticsGuide', () => {
  it('renders every baseline section title', () => {
    const { getByText } = renderWithTheme(<AnalyticsGuide />);
    for (const section of GUIDE_SECTIONS) {
      expect(getByText(section.title)).toBeInTheDocument();
    }
  });

  it('renders a metric with both calculation and source rows', () => {
    const { getAllByText } = renderWithTheme(<AnalyticsGuide />);
    expect(getAllByText('Calculation:').length).toBeGreaterThan(0);
    expect(getAllByText('Data source:').length).toBeGreaterThan(0);
  });

  it('renders a metric name and description verbatim (COPY parity)', () => {
    const { getByText, getAllByText } = renderWithTheme(<AnalyticsGuide />);
    expect(getByText('TEAM')).toBeInTheDocument();
    expect(getAllByText(/AI ACTIVE/).length).toBeGreaterThan(0);
  });
});
