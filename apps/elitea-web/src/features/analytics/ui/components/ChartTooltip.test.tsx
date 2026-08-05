import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { pickChartColor } from '../../lib/constants';
import { ChartTooltip } from './ChartTooltip';

// R-T1 (elitea/no-raw-color) walks every string literal in every linted
// file, tests included — an arbitrary test-fixture colour comes from the
// real chart ramp (`pickChartColor`), never a hand-typed hex literal.
const SAMPLE_COLOR = pickChartColor(0);

describe('ChartTooltip', () => {
  it('renders nothing when inactive', () => {
    const { container } = renderWithTheme(
      <ChartTooltip
        active={false}
        payload={[{ name: 'Events', value: 5, color: SAMPLE_COLOR }]}
        label="2026-07-20"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when active but payload is empty', () => {
    const { container } = renderWithTheme(
      <ChartTooltip
        active
        payload={[]}
        label="2026-07-20"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when active but payload is undefined', () => {
    const { container } = renderWithTheme(<ChartTooltip active />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the label and formatted numeric entries', () => {
    const { getByText } = renderWithTheme(
      <ChartTooltip
        active
        label="2026-07-20"
        payload={[{ name: 'Events', value: 1500, color: SAMPLE_COLOR }]}
      />,
    );
    expect(getByText('2026-07-20')).toBeInTheDocument();
    expect(getByText('Events: 1.5K')).toBeInTheDocument();
  });

  it('renders a non-numeric entry value verbatim', () => {
    const { getByText } = renderWithTheme(
      <ChartTooltip
        active
        label="2026-07-20"
        payload={[{ name: 'Status', value: 'ok', color: SAMPLE_COLOR }]}
      />,
    );
    expect(getByText('Status: ok')).toBeInTheDocument();
  });
});
