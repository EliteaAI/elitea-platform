import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { PlusIcon } from '@/shared/ui/icons/plus-icon';

import { DeprecatedConstants, FlowEditorConstants } from '../lib/flow-editor/constants';
import { getNodeIconByType } from '../lib/flow-editor/helpers/node.helpers';
import type { PipelineNodeType } from '../lib/flow-editor/constants/flowEditor.constants';

/**
 * Ported from `apps/elitea-ui/src/pages/Pipelines/Components/AddNodeMenu.jsx`
 * (`PipelineAddNodeMenu`).
 *
 * `data-tour={PIPELINE_TOUR_TARGET_IDS.nodes}` (baseline:
 * `features/interactive-tours`) is DROPPED — that domain does not exist in
 * this worktree and is out of this Wave-2 batch's scope entirely
 * (agents/pipelines/toolkits only), same treatment `FlowEditor.tsx`'s own
 * doc comment already established for the identical `PIPELINE_TOUR_TARGET_IDS`
 * dependency (`no-sideways-features`, no carve-out).
 */
export interface AddNodeMenuProps {
  readonly onAddNode: (type: PipelineNodeType) => void;
  readonly disabled?: boolean | undefined;
}

interface MenuItemEntry {
  readonly type: PipelineNodeType;
  readonly label: string;
  readonly icon: ReactNode;
}

/** `AddNodeMenu.jsx`'s `getVisibleNodeTypes` — the declared KEYS of `PipelineNodeTypes` (e.g. `'Tool'`), sorted, minus the deprecated/invisible ones, mapped back to their VALUE (e.g. `'tool'`). */
function getVisibleNodeTypes(): readonly PipelineNodeType[] {
  const types = FlowEditorConstants.PipelineNodeTypes as Readonly<Record<string, PipelineNodeType>>;
  return Object.keys(types)
    .sort()
    .filter((key) => !DeprecatedConstants.DeprecatedOrInvisibleNode.includes(key))
    .map((key) => types[key])
    .filter((value): value is PipelineNodeType => value !== undefined);
}

const menuColumnsSx: SxProps<Theme> = { display: 'flex' };
const menuColumnSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', minWidth: '13rem', gap: '0.125rem', padding: '0 0.25rem' };
// `sx` already wins over MUI's `styleOverrides` at the CSS layer (R-T5 bans `!important`
// outright; no waiver on hand) — dropping the baseline's `!important` on `minWidth`.
const listItemIconSx: SxProps<Theme> = {
  minWidth: '1.5rem',
  maxWidth: '1.5rem',
  '& svg': { width: '1rem', height: '1rem', display: 'block' },
};
const menuItemSx: SxProps<Theme> = { minHeight: '3rem', borderRadius: ({ vars }) => vars.shape.radiusMd };
const triggerButtonSx: SxProps<Theme> = { marginLeft: '0' };

export const AddNodeMenu = memo(function AddNodeMenu({ onAddNode, disabled }: AddNodeMenuProps): ReactNode {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const theme = useTheme();

  const menuItems = useMemo<readonly MenuItemEntry[]>(() => {
    const displayNames = FlowEditorConstants.PipelineNodeDisplayNames;
    return getVisibleNodeTypes()
      .map((type) => ({
        type,
        label: displayNames[type],
        icon: getNodeIconByType(type, theme, theme.vars.palette.icon.fill.secondary),
      }))
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  }, [theme]);

  const leftColumnItems = useMemo(() => menuItems.slice(0, 6), [menuItems]);
  const rightColumnItems = useMemo(() => menuItems.slice(6), [menuItems]);

  const handleOpen = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  }, []);

  const handleClose = useCallback(() => setAnchorEl(null), []);

  const handleItemClick = useCallback(
    (type: PipelineNodeType) => () => {
      onAddNode(type);
      handleClose();
    },
    [handleClose, onAddNode],
  );

  return (
    <>
      <Tooltip
        title={t('features.pipelines.editorPanel.addNodeMenu.tooltip', 'Add node')}
        placement="top"
        enterDelay={500}
      >
        <IconButton
          id="pipeline-add-node-menu-action"
          aria-label={t('features.pipelines.editorPanel.addNodeMenu.ariaLabel', 'Add node')}
          aria-controls={open ? 'pipeline-add-node-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
          onClick={handleOpen}
          disabled={disabled}
          sx={triggerButtonSx}
        >
          <PlusIcon fill={theme.vars.palette.icon.fill.send} />
        </IconButton>
      </Tooltip>
      <Menu
        id="pipeline-add-node-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={menuColumnsSx}>
          <Box sx={menuColumnSx}>
            {leftColumnItems.map((item) => (
              <MenuItem
                key={item.type}
                onClick={handleItemClick(item.type)}
                sx={menuItemSx}
              >
                <ListItemIcon sx={listItemIconSx}>{item.icon}</ListItemIcon>
                <ListItemText
                  primary={
                    <Typography
                      variant="bodyMedium"
                      color="text.secondary"
                      noWrap
                    >
                      {item.label}
                    </Typography>
                  }
                />
              </MenuItem>
            ))}
          </Box>
          <Box sx={menuColumnSx}>
            {rightColumnItems.map((item) => (
              <MenuItem
                key={item.type}
                onClick={handleItemClick(item.type)}
                sx={menuItemSx}
              >
                <ListItemIcon sx={listItemIconSx}>{item.icon}</ListItemIcon>
                <ListItemText
                  primary={
                    <Typography
                      variant="bodyMedium"
                      color="text.secondary"
                      noWrap
                    >
                      {item.label}
                    </Typography>
                  }
                />
              </MenuItem>
            ))}
          </Box>
        </Box>
      </Menu>
    </>
  );
});
