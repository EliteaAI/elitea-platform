import type { ReactNode } from 'react';

import { Rectangle } from 'recharts';
import type { BarShapeProps } from 'recharts';

/**
 * Per-bar colour for `AnalyticsAgents`/`AnalyticsTools`'s "most active"
 * bar charts, replacing the baseline's per-datum `<Cell fill=.../>`
 * children. recharts 3.10.1 deprecates `Cell` in favour of a `shape`
 * render function on `<Bar>` (`node_modules/recharts/types/component/
 * Cell.d.ts`: "This component is now deprecated ... Please use the
 * `shape` prop"); `oxlint-tsgolint`'s `no-deprecated` rule enforces this
 * live. `payload` carries this chart's own datum (typed loosely by
 * recharts itself, `BarRectangleItem.payload?: any`), which is where the
 * per-bar `color` this feature computes (`pickChartColor`) already lives.
 */
export function renderColoredBar(props: BarShapeProps): ReactNode {
  const color = (props.payload as { color?: string } | undefined)?.color;
  return (
    <Rectangle
      {...props}
      fill={color ?? props.fill}
    />
  );
}
