/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/GhostNode.jsx` (39 lines, unit A2e). A near-invisible, non-
 * connectable placeholder node used by the layout pass as a synthetic
 * anchor point.
 *
 * DISCLOSED DEVIATION: the baseline's `borderRadius: '50%'` (a plain style
 * object passed to `<Handle style={...}>`, not `sx`) is banned outright by
 * R-T10 regardless of value -- `theme.vars.shape.radiusPill` (looked up via
 * `useTheme()`, since a plain `style` object has no `sx` theme callback to
 * read it from) is used for both the wrapper `Box` and the `Handle`, giving
 * the same fully-rounded circle at this node's fixed 1.125rem size.
 */
import type { ReactNode } from 'react';
import { memo } from 'react';

import Box from '@mui/material/Box';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles';

import { Handle, Position } from '@xyflow/react';

const boxSx: SxProps<Theme> = (theme: Theme) => ({
  width: '1.125rem',
  height: '1.125rem',
  borderRadius: theme.vars.shape.radiusPill,
});

export const GhostNode = memo(function GhostNode(): ReactNode {
  const theme = useTheme();

  return (
    <Box sx={boxSx}>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={{
          width: '1.125rem',
          height: '1.125rem',
          borderRadius: theme.vars.shape.radiusPill,
          top: '.5625rem',
        }}
      />
    </Box>
  );
});
