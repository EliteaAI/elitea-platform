import { describe, expect, it } from 'vitest';
import type { BarShapeProps } from 'recharts';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { pickChartColor } from '../../lib/constants';
import { renderColoredBar } from './coloredBarShape';

/**
 * `BarShapeProps` is a large recharts-internal type; only the fields
 * `renderColoredBar` actually reads (`payload`, `fill`, plus whatever
 * `Rectangle` needs to paint) matter here — the rest are supplied as
 * plausible recharts defaults.
 *
 * Every colour below comes from `pickChartColor` (R-T1/elitea/no-raw-color
 * walks every string literal in every linted file, tests included — never
 * a hand-typed hex literal), each a genuinely distinct ramp entry so a
 * mixed-up precedence test would fail loudly rather than by coincidence.
 */
function makeProps(overrides: Partial<BarShapeProps> = {}): BarShapeProps {
  return {
    x: 0,
    y: 0,
    width: 10,
    height: 20,
    value: 5,
    tooltipPosition: { x: 0, y: 0 },
    parentViewBox: { x: 0, y: 0, width: 100, height: 100 },
    stackedBarStart: 0,
    originalDataIndex: 0,
    isActive: false,
    index: 0,
    fill: pickChartColor(0),
    ...overrides,
  };
}

describe('renderColoredBar', () => {
  it("uses the datum's own payload.color when present", () => {
    const props = makeProps({ payload: { color: pickChartColor(1) } });
    const { container } = renderWithTheme(<>{renderColoredBar(props)}</>);
    const path = container.querySelector('path');
    expect(path).toHaveAttribute('fill', pickChartColor(1));
  });

  it("falls back to the shape props' own fill when payload has no color field", () => {
    const props = makeProps({ payload: {}, fill: pickChartColor(2) });
    const { container } = renderWithTheme(<>{renderColoredBar(props)}</>);
    const path = container.querySelector('path');
    expect(path).toHaveAttribute('fill', pickChartColor(2));
  });

  it("falls back to the shape props' own fill when payload is undefined", () => {
    const props = makeProps({ payload: undefined, fill: pickChartColor(3) });
    const { container } = renderWithTheme(<>{renderColoredBar(props)}</>);
    const path = container.querySelector('path');
    expect(path).toHaveAttribute('fill', pickChartColor(3));
  });
});
