/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/EndNode.jsx` (79 lines, unit A2e).
 *
 * DISCLOSED DEVIATIONS, each forced by a real, verified constraint:
 *
 *  - `theme.palette.*` -> `theme.vars.palette.*` (R-T7).
 *  - `borderRadius: '0.5rem'` -> `theme.vars.shape.radiusLg` (16px, exact
 *    match); the icon container's `borderRadius: '0.25rem'` -> `radiusSm`
 *    (4px, exact match). R-T10 bans the literals either way.
 *  - `marginRight: '0.5rem'` -> `theme.spacing(1)` (R-T9 bans raw px/rem in
 *    margin/padding/gap; this app's default spacing unit is 8px = 0.5rem).
 *  - Typed via `@xyflow/react`'s `NodeProps<FlowNode>` instead of the
 *    baseline's untyped destructured props.
 *  - `FlowEditorContext`/`NodeCardContext` come from `../../lib/flow-editor/
 *    flowEditorContext` (unit A2d) instead of the baseline's `app/providers`
 *    import -- see that file's own header for the R-L1 rationale (`app/`
 *    sits above `features/` in the layer model).
 */
import type { ReactNode } from 'react';
import { memo, useContext } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles';

import { Handle, Position, type NodeProps } from '@xyflow/react';

import { FlowEditorContext, NodeCardContext } from '../../lib/flow-editor/flowEditorContext';
import type { FlowNode } from '../../lib/flow-editor/reactFlowTypes';
import { FlagIcon } from '@/shared/ui/icons/flag-icon';
import { t } from '@/shared/i18n';

interface EndNodeStyles {
  readonly container: SxProps<Theme>;
  readonly handle: { readonly width: string; readonly height: string; readonly borderRadius: string | number };
  readonly iconContainer: SxProps<Theme>;
  readonly icon: { readonly width: string; readonly height: string };
}

function endNodeStyles(
  theme: Theme,
  isPerforming: boolean | undefined,
  isRunningPipeline: boolean | undefined,
  selected: boolean | undefined,
): EndNodeStyles {
  return {
    container: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      width: '6.25rem',
      height: '2.75rem',
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)} ${theme.spacing(0.5)} ${theme.spacing(0.75)}`,
      borderRadius: theme.vars.shape.radiusLg,
      border: `${isPerforming ? '.125rem dashed' : '.0625rem solid'} ${
        isPerforming || (!isRunningPipeline && selected)
          ? theme.vars.palette.primary.main
          : theme.vars.palette.border.flowNode
      }`,
      background: theme.vars.palette.background.tabPanel,
    },
    handle: { width: '.75rem', height: '.75rem', borderRadius: theme.vars.shape.radiusPill },
    iconContainer: {
      width: '1.5rem',
      height: '1.5rem',
      borderRadius: theme.vars.shape.radiusSm,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      border: `.0625rem solid ${theme.vars.palette.border.flowNode}`,
      color: theme.vars.palette.text.secondary,
      marginRight: theme.spacing(1),
    },
    icon: { width: '1rem', height: '1rem' },
  };
}

export const EndNode = memo(function EndNode(props: NodeProps<FlowNode>): ReactNode {
  const { selected, data } = props;

  const flowEditorContext = useContext(FlowEditorContext);
  const theme = useTheme();
  const styles = endNodeStyles(theme, data?.isPerforming, flowEditorContext?.isRunningPipeline, selected);

  return (
    <NodeCardContext.Provider value={{ isExpanded: Boolean(flowEditorContext?.expandAll) }}>
      <Box sx={styles.container}>
        <Box sx={styles.iconContainer}>
          <FlagIcon style={styles.icon} />
        </Box>
        <Typography
          variant="labelMedium"
          color="text.secondary"
        >
          {t('pipelines.flowEditor.endNode.label', 'End')}
        </Typography>
        <Handle
          type="target"
          id="target"
          position={Position.Top}
          isConnectable
          style={styles.handle}
        />
      </Box>
    </NodeCardContext.Provider>
  );
});
