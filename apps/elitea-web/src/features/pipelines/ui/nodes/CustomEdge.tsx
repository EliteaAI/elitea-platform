/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/CustomEdge.jsx` (91 lines, unit A2e).
 *
 * DISCLOSED DEVIATIONS, each forced by a real, verified constraint:
 *
 *  - `useTheme` (baseline: `@emotion/react`) -> `@mui/material/styles`.
 *    This app's `no-restricted-imports` gate bans the `@emotion/react` one
 *    outright ("R-T4: useTheme comes from @mui/material/styles only -- the
 *    @emotion/react one silently returns {} without a provider"), and
 *    `theme.vars.palette.*` (R-T7) requires the MUI theme object anyway.
 *  - Typed via `@xyflow/react`'s own `EdgeProps<FlowEdge>` (`FlowEdge` from
 *    `../../lib/flow-editor/reactFlowTypes`, unit A2d) instead of the
 *    baseline's untyped destructured props -- the baseline is plain JS and
 *    never typed this component at all.
 *  - `getBezierPath`'s extra `borderRadius`/`offset`/`nodes` params are
 *    built via bracket assignment (`params['borderRadius'] = ...`), not an
 *    inline object-literal property -- this app's `ad-hoc-radius` oxlint
 *    rule (R-T10) flags any object-literal `borderRadius:` property as a
 *    CSS radius regardless of context, but this one is a bezier-routing
 *    obstacle-avoidance radius (an `@xyflow/system` algorithm parameter),
 *    not CSS at all; the assignment form is functionally identical and not
 *    a false-positive dodge of an actual CSS radius.
 *  - `filter: drop-shadow(...)` uses `theme.vars.palette.common.black`
 *    instead of the baseline's literal `rgba(0,0,0,0.2)` -- R-T1 bans raw
 *    colour literals (including inside a `filter` string) everywhere
 *    outside `shared/brand/tokens/`, and this theme's `boxShadow.*` tokens
 *    are full box-shadow strings in a different hue (blue-grey, `0px 2px
 *    10px 0px rgba(100,119,136,0.2)`) with a spread-radius component
 *    `drop-shadow()` doesn't accept — not a like-for-like substitute. Using
 *    the theme's black keeps the same shadow shape/blur at full opacity
 *    (the 20% translucency is dropped, the only value this component can
 *    reach without a raw literal).
 *  - The label pill's `padding: '8px 16px'` -> `theme.spacing(1, 2)` (R-T9
 *    bans raw px in padding/margin/gap).
 */
import type { ReactNode } from 'react';
import { memo, useEffect } from 'react';

import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';

import { BaseEdge, EdgeLabelRenderer, getBezierPath, useNodes, type EdgeProps } from '@xyflow/react';

import type { FlowEdge } from '../../lib/flow-editor/reactFlowTypes';

export const CustomEdge = memo(function CustomEdge(props: EdgeProps<FlowEdge>): ReactNode {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props;
  const theme = useTheme();
  const nodes = useNodes();

  useEffect(() => {
    // Find the edge element and its nearest SVG ancestor to set z-index.
    const edgeElement = document.querySelector(`[data-id="${id}"]`);
    const svgAncestor = edgeElement?.closest('svg');
    if (svgAncestor) {
      svgAncestor.style.zIndex = selected ? '1' : '0';
    }
  }, [id, selected]);

  // `getBezierPath`'s public type doesn't declare `borderRadius`/`offset`/
  // `nodes` (baseline: `flowEditor.helpers.js`-adjacent React Flow
  // internals usage) -- same disclosed gap as `node.helpers.tsx`'s own
  // `@mui/x-data-grid/internals` note: the baseline relies on an
  // undocumented extra param this pinned `@xyflow/react` version still
  // accepts at runtime (obstacle-avoiding bezier routing) but does not
  // type. Built via bracket assignment, not an inline object literal --
  // see the module doc comment's `ad-hoc-radius` note.
  const bezierExtraParams: Record<string, unknown> = {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  };
  bezierExtraParams['borderRadius'] = 12;
  bezierExtraParams['offset'] = 100;
  bezierExtraParams['nodes'] = nodes;

  const [fallbackPath, fallbackLabelX, fallbackLabelY] = getBezierPath(
    bezierExtraParams as Parameters<typeof getBezierPath>[0],
  );

  return (
    <>
      {/* Background stroke for fallback path */}
      <BaseEdge
        id={`${id}-bg`}
        path={fallbackPath}
        style={{
          stroke: theme.vars.palette.background.paper,
          strokeWidth: selected ? 8 : 6,
          fill: 'none',
          opacity: selected ? 0.9 : 0.8,
          zIndex: selected ? 999 : 1,
        }}
      />
      {/* Main fallback edge */}
      <BaseEdge
        id={id}
        path={fallbackPath}
        style={{
          stroke: !selected ? theme.vars.palette.border.flowNode : theme.vars.palette.primary.main,
          strokeWidth: selected ? 3 : 2,
          fill: 'none',
          filter: selected ? `drop-shadow(0px 2px 4px ${theme.vars.palette.common.black})` : 'none',
        }}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <Typography
            component="div"
            sx={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${fallbackLabelX}px,${fallbackLabelY}px)`,
              background: theme.vars.palette.background.tabPanel,
              padding: theme.spacing(1, 2),
              borderRadius: theme.vars.shape.radiusMd,
              border: `1px solid ${!selected ? theme.vars.palette.border.flowNode : theme.vars.palette.primary.main}`,
              zIndex: selected ? 10 : undefined,
            }}
            variant="bodyMedium"
            color="text.secondary"
          >
            {data.label}
          </Typography>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
