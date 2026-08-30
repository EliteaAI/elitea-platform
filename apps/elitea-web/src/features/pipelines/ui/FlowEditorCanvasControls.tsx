/**
 * `FlowEditor.jsx:563-606`'s `<Controls>` JSX (the "toggle card size" /
 * "auto-arrange" pair rendered inside `<ReactFlow>`), split into its own
 * component purely to keep `FlowEditor.tsx` itself under the §3.5 400-line
 * file-length budget.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import { Background, ControlButton } from '@xyflow/react';

import { t } from '@/shared/i18n';
import { CollapseSecondIcon } from '@/shared/ui/icons/collapse-second-icon';
import { ExpandThirdIcon } from '@/shared/ui/icons/expand-third-icon';
import { PolylineOutlineIcon } from '@/shared/ui/icons/polyline-outline-icon';

import { StyledFlowControls } from './FlowEditor.styles';

/**
 * The baseline's `styles.icon` (`fontSize: '1rem'`) has no effect on a raw
 * `<svg>` icon component (`ComponentProps<'svg'>`, not MUI's `SvgIcon`) —
 * kept as an explicit inline `style` (width/height) instead, since these
 * icons no longer accept `sx` at all (Wave-1 unit S2's plain-`forwardRef`-
 * `<svg>` port, not a `styled(SvgIcon)` wrapper the baseline's own icons
 * were).
 */
const flowEditorIconStyle = { width: '1rem', height: '1rem' };

/** `FlowEditor.jsx:556-562`'s `<Background>` — grouped in this file (not `FlowEditor.tsx`) alongside its sibling `<Controls>` chrome, both `<ReactFlow>` children. */
export function FlowEditorBackground(): ReactNode {
  const theme = useTheme();
  return (
    <Background
      color={theme.vars.palette.border.lines}
      bgColor={theme.vars.palette.background.secondary}
      size={1.5}
      offset={[0, 2]}
      gap={20}
    />
  );
}

export interface FlowEditorCanvasControlsProps {
  readonly expandAll: boolean;
  readonly onExpandAll: () => void;
  readonly onReLayout: () => void;
}

/**
 * Both custom `ControlButton`s carry an `aria-label` holding the same string
 * their `Tooltip` shows.
 *
 * The tooltip alone never named them: MUI puts `title`/`aria-describedby` on
 * the element it wraps, and what it wraps here is the `<Box component="span">`
 * (a `ControlButton` renders a bare `<button>` and forwards no ref, so it
 * cannot be a Tooltip child directly). The `<button>` inside therefore had NO
 * accessible name at all, while `<Controls>`'s own four built-ins ("Zoom In",
 * "Zoom Out", "Fit View", "Toggle Interactivity") all have one.
 *
 * axe cannot see it: `e2e/fixtures/axe.ts` calls `.exclude('.react-flow')`, and
 * these buttons live inside that subtree — so `button-name` has never been
 * evaluated on them and the pipeline-editor a11y journey passes either way.
 * `ControlButton` spreads `...rest` onto the `<button>` (@xyflow/react 12.11.2),
 * so the label lands on the element that needs it.
 */
export function FlowEditorCanvasControls({ expandAll, onExpandAll, onReLayout }: FlowEditorCanvasControlsProps): ReactNode {
  const theme = useTheme();

  return (
    <StyledFlowControls>
      <Tooltip
        title={t('pipelines.flowEditor.toggleCardsSize', 'Toggle cards size')}
        placement="right"
      >
        <Box
          component="span"
          sx={{ display: 'inline-flex', borderBottom: `0.0625rem solid ${theme.vars.palette.divider}` }}
        >
          <ControlButton
            onClick={onExpandAll}
            aria-label={t('pipelines.flowEditor.toggleCardsSize', 'Toggle cards size')}
          >
            {expandAll ? (
              <CollapseSecondIcon
                style={flowEditorIconStyle}
                fill={theme.vars.palette.icon.fill.secondary}
              />
            ) : (
              <ExpandThirdIcon
                style={flowEditorIconStyle}
                fill={theme.vars.palette.icon.fill.secondary}
              />
            )}
          </ControlButton>
        </Box>
      </Tooltip>
      <Tooltip
        title={t('pipelines.flowEditor.autoArrange', 'Auto-arrange')}
        placement="right"
      >
        <Box
          component="span"
          sx={{ display: 'inline-flex' }}
        >
          <ControlButton
            onClick={onReLayout}
            aria-label={t('pipelines.flowEditor.autoArrange', 'Auto-arrange')}
          >
            <PolylineOutlineIcon
              style={flowEditorIconStyle}
              fill={theme.vars.palette.icon.fill.secondary}
            />
          </ControlButton>
        </Box>
      </Tooltip>
    </StyledFlowControls>
  );
}
