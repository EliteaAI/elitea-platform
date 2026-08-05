/**
 * The "Conditional outputs" chip list, split out of `ConditionNode.tsx`
 * (baseline: `ConditionNode.jsx:280-303`) purely to keep that component
 * under the §3.5 `complexity` budget (12) — the per-output `getBorderColorAndTooltip`
 * lookup, `Tooltip`, and deletable `Chip` render is real UI, not dead
 * weight, so it moves to its own function component rather than being
 * dropped. No behaviour change from the extraction alone.
 *
 * Styling/substitution choices mirror the already-landed sibling
 * `ui/nodes/DecisionNode/DecisionNodeShared.tsx`'s (unit A2f) own
 * `DecisionOutputs` component, which renders the SAME
 * `getBorderColorAndTooltip`-driven chip list for a sibling node type —
 * see that file's own doc comment for the `StyledChip`/`StyledTooltip` ->
 * MUI `Chip`/`Tooltip`, `& .MuiChip-deleteIcon` -> colour-wrapped-icon
 * (R-T6), and radius-token (R-T10) rationale, not repeated verbatim here.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import { getBorderColorAndTooltip } from '../../../lib/flow-editor/helpers/decisionOutput.helpers';
import type { DecisionOutputBorderColor } from '../../../lib/flow-editor/helpers/decisionOutput.helpers';
import type { FlowGraphEdge, FlowGraphNode } from '../../../lib/flow-editor/helpers/pipelineFlow.types';
import { RemoveIcon } from '@/shared/ui/icons/remove-icon';

export interface ConditionOutputsListProps {
  readonly id: string;
  readonly conditionOutput: readonly string[];
  readonly onRemoveOutput: (output: string) => () => void;
  readonly edges: readonly FlowGraphEdge[];
  readonly nodes: readonly FlowGraphNode[];
}

const outputsBorderContainerSx = (theme: Theme): SxProps<Theme> => ({
  width: '100%',
  height: 'auto',
  borderRadius: theme.vars.shape.radiusMd,
  border: `.0625rem solid ${theme.vars.palette.border.lines}`,
  display: 'flex',
  alignItems: 'center',
  padding: '.75rem 1rem',
  gap: '.5rem',
  boxSizing: 'border-box',
  flexWrap: 'wrap',
});

/**
 * `theme.vars.palette.status[borderColor]` (a computed index) is invisible
 * to the §4.6 check 7 reference scan (`shared/brand/__tests__/
 * reference-scan.ts`'s `classifyMember`/`staticPath`: "theme.vars.palette
 * must be read through a static dotted path (no computed access, no
 * aliasing)") — resolved via this static per-branch switch instead so every
 * token read is a literal dotted path the scan can see, same fix
 * `DecisionNodeShared.tsx`'s own `resolveBorderStatusColor` applies for the
 * identical `getBorderColorAndTooltip`-driven lookup.
 */
function resolveBorderStatusColor(theme: Theme, borderColor: DecisionOutputBorderColor): string {
  switch (borderColor) {
    case 'rejected':
      return theme.vars.palette.status.rejected;
    case 'published':
      return theme.vars.palette.status.published;
    case 'onModeration':
      return theme.vars.palette.status.onModeration;
  }
}

/** Approximated to `radiusLg` (16px) — the baseline's `1.25rem` (20px) fully-rounded pill has no exact token match (R-T10: 4/8/16px), same disclosed approximation `DecisionNodeShared.tsx`'s own `styledChip` already applies for the identical baseline shape. */
const outputChipSx = (theme: Theme, borderColor: string): SxProps<Theme> => ({
  padding: '0rem .5rem',
  height: '1.5rem',
  borderRadius: theme.vars.shape.radiusLg,
  marginBottom: '0rem',
  marginRight: '0rem',
  gap: '.25rem',
  border: `.0625rem solid ${borderColor}`,
});

function ConditionOutputChip({
  id,
  item,
  onRemoveOutput,
  edges,
  nodes,
}: {
  readonly id: string;
  readonly item: string;
  readonly onRemoveOutput: (output: string) => () => void;
  readonly edges: readonly FlowGraphEdge[];
  readonly nodes: readonly FlowGraphNode[];
}): ReactNode {
  const theme = useTheme();
  const { borderColor, tooltip } = getBorderColorAndTooltip(edges, nodes, id, item);

  return (
    <Tooltip
      title={tooltip}
      placement="top"
    >
      <Chip
        label={item}
        className="nopan nodrag nowheel"
        sx={outputChipSx(theme, resolveBorderStatusColor(theme, borderColor))}
        deleteIcon={
          <Box
            component="span"
            data-testid="condition-output-remove"
            sx={{ display: 'inline-flex', color: theme.vars.palette.icon.fill.secondary }}
          >
            <RemoveIcon />
          </Box>
        }
        onDelete={onRemoveOutput(item)}
      />
    </Tooltip>
  );
}

export function ConditionOutputsList(props: ConditionOutputsListProps): ReactNode {
  const { id, conditionOutput, onRemoveOutput, edges, nodes } = props;
  const theme = useTheme();

  return (
    <Box sx={outputsBorderContainerSx(theme)}>
      {conditionOutput.map(item => (
        <ConditionOutputChip
          key={item}
          id={id}
          item={item}
          onRemoveOutput={onRemoveOutput}
          edges={edges}
          nodes={nodes}
        />
      ))}
    </Box>
  );
}
