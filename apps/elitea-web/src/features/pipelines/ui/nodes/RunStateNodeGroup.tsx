/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * nodes/RunStateNodeGroup.jsx` (155 lines) — unit A2f. Self-contained aside
 * from `./RunStateNode.tsx` (this same sub-unit — intra-slice, R-L3 does
 * not restrict it), which itself has one not-yet-landed dependency
 * (`RunStateDialog`, A2j) — see that file's own doc comment.
 *
 * `nodes` keeps the baseline's own node-shaped contract (`RunStateNodeGroup.
 * jsx:16-33` spreads `{...onlyNode}`/`{...run}` — each array entry is a
 * React-Flow-`Node`-shaped `{id, data, selected?}` object, `data` carrying
 * `RunStateNode`'s own `status`/`label` — not a flattened
 * `{id, status, label}` record). Matches `./RunStateNode.tsx`'s own
 * `id`/`data`/`selected` props exactly, so no adapter is needed at this
 * component's boundary.
 */
import type { MouseEvent, ReactNode } from 'react';
import { memo, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import type { SxProps, Theme } from '@mui/material/styles';

import { ClockIcon } from '@/shared/ui/icons/clock-icon';

import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import { RunStateNode, type RunStateNodeData } from './RunStateNode';

export interface RunStateGraphNode {
  readonly id: string;
  readonly data: RunStateNodeData;
  readonly selected?: boolean | undefined;
}

export interface RunStateNodeGroupProps {
  readonly nodes: readonly RunStateGraphNode[];
  readonly deleteRunNode: (id: string) => void;
  readonly handleStopRun: (id: string) => void;
  readonly yamlJsonObject: YamlPipelineDocument;
  readonly editorHeight?: number | undefined;
  readonly editorWidth?: number | undefined;
}

export const RunStateNodeGroup = memo(function RunStateNodeGroup(props: RunStateNodeGroupProps): ReactNode {
  const { nodes, deleteRunNode, handleStopRun, yamlJsonObject, editorHeight, editorWidth } = props;

  const styles = flowEditorStyles();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const { onlyNode, last, history } = useMemo(
    () => ({ onlyNode: nodes[0], last: nodes[nodes.length - 1], history: nodes.slice(0, -1) }),
    [nodes],
  );

  const toggleHistory = (target: HTMLElement | null): void => setAnchorEl(target);

  if (!nodes.length) return null;

  if (nodes.length === 1 && onlyNode) {
    return (
      <RunStateNode
        key={onlyNode.id}
        id={onlyNode.id}
        data={onlyNode.data}
        selected={onlyNode.selected}
        deleteRunNode={deleteRunNode}
        onStopRun={handleStopRun}
        yamlJsonObject={yamlJsonObject}
        editorHeight={editorHeight}
        editorWidth={editorWidth}
      />
    );
  }

  return (
    <Box sx={styles.wrapper}>
      <Box
        sx={styles.historyWrapper}
        onClick={(event: MouseEvent<HTMLElement>) => toggleHistory(event.currentTarget)}
      >
        <ClockIcon />
      </Box>
      <Menu
        id="runNodes-history-menu"
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => toggleHistory(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ list: { sx: styles.historyList }, paper: { sx: styles.historyMenu } }}
      >
        {history.map(run => (
          <MenuItem key={run.id}>
            <RunStateNode
              avoidTooltip
              id={run.id}
              data={run.data}
              selected={run.selected}
              deleteRunNode={deleteRunNode}
              onStopRun={handleStopRun}
              yamlJsonObject={yamlJsonObject}
              editorHeight={editorHeight}
              editorWidth={editorWidth}
            />
          </MenuItem>
        ))}
      </Menu>
      {last && (
        <RunStateNode
          key={last.id}
          id={last.id}
          data={last.data}
          selected={last.selected}
          deleteRunNode={deleteRunNode}
          onStopRun={handleStopRun}
          yamlJsonObject={yamlJsonObject}
          editorHeight={editorHeight}
          editorWidth={editorWidth}
        />
      )}
    </Box>
  );
});

interface FlowEditorGroupStyles {
  readonly wrapper: SxProps<Theme>;
  readonly historyWrapper: SxProps<Theme>;
  readonly historyMenu: SxProps<Theme>;
  readonly historyList: SxProps<Theme>;
}

function flowEditorStyles(): FlowEditorGroupStyles {
  return {
    wrapper: (theme: Theme) => ({ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: theme.spacing(0.5) }),
    historyWrapper: (theme: Theme) => ({
      borderRadius: theme.vars.shape.radiusMd,
      border: `.0625rem solid ${theme.vars.palette.border.lines}`,
      background: theme.vars.palette.background.tabPanel,
      height: theme.spacing(2.25),
      width: theme.spacing(2.25),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      '&:hover': {
        cursor: 'pointer',
        border: `.0625rem solid ${theme.vars.palette.background.button.primary.disabled}`,
        background: theme.vars.palette.background.dataGrid.main,
        svg: { path: { fill: theme.vars.palette.text.secondary } },
      },
    }),
    historyMenu: (theme: Theme) => ({
      borderRadius: theme.vars.shape.radiusMd,
      border: `.0625rem solid ${theme.vars.palette.border.lines}`,
      background: theme.vars.palette.background.secondary,
      marginTop: theme.spacing(0.5),
      minWidth: '13.75rem',
    }),
    historyList: {
      paddingTop: 0,
      paddingBottom: 0,
      li: {
        padding: 0,
        minHeight: '2.5rem',
        // `borderRadius: 0` (baseline) dropped — R-T10 bans ad-hoc radius
        // literals including zero and there is no "no radius" token; `0` is
        // also plain CSS `border-radius`'s own initial value, so an
        // unstyled `<div>` already renders identically without it.
        div: { width: '100%', height: '100%', border: 'none', padding: '.5rem' },
      },
    },
  };
}
