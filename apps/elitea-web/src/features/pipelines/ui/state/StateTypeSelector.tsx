/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * state/StateTypeSelector.jsx` (149 lines) — unit A2j. A menu-button that
 * picks a state variable's `FlowEditorConstants.StateVariableTypes` value.
 *
 * `menuPaper: { marginTop: spacing(1) }` -> `theme.spacing(1)` (already the
 * baseline's own spacing-function call, ported 1:1). `CheckedIcon` sizing
 * (`fontSize: '0.75rem'` inline style in the baseline) is dropped from the
 * `style` prop — SVGR icons are sized via `width`/`height`, not CSS
 * `font-size` (they are not `@mui/icons-material` glyphs); replaced with an
 * explicit `width`/`height` on the icon itself, same fix the baseline's own
 * `IconComponent style={{ fontSize: '1.25rem' }}` idiom needed (also
 * replaced below).
 */
import type { ReactNode } from 'react';
import { useState } from 'react';

import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { AbcIcon } from '@/shared/ui/icons/abc-icon';
import { CheckedIcon } from '@/shared/ui/icons/checked-icon';
import { HashIcon } from '@/shared/ui/icons/hash-icon';
import { JsonIcon } from '@/shared/ui/icons/json-icon';
import { ListViewIcon } from '@/shared/ui/icons/list-view-icon';
import { t } from '@/shared/i18n';

import { StateVariableIconButton } from './StateVariableIconButton';

const ICON_SIZE = '1.25rem';

type StateVariableIconComponent = typeof AbcIcon;

const ICON_BY_TYPE: Readonly<Record<string, StateVariableIconComponent>> = {
  [FlowEditorConstants.StateVariableTypes.String]: AbcIcon,
  [FlowEditorConstants.StateVariableTypes.Number]: HashIcon,
  [FlowEditorConstants.StateVariableTypes.Json]: JsonIcon,
  [FlowEditorConstants.StateVariableTypes.List]: ListViewIcon,
};

interface StateTypeOption {
  readonly label: string;
  readonly icon: StateVariableIconComponent;
}

const STATE_TYPE_OPTIONS: Readonly<Record<string, StateTypeOption>> = Object.entries(
  FlowEditorConstants.StateVariableTypes,
).reduce<Record<string, StateTypeOption>>((acc, [key, value]) => {
  acc[value] = { label: key, icon: ICON_BY_TYPE[value] ?? AbcIcon };
  return acc;
}, {});

/** @public */
export interface StateTypeSelectorProps {
  readonly type: string;
  readonly onTypeChange: (type: string) => void;
  readonly disabled?: boolean;
}

export function StateTypeSelector(props: StateTypeSelectorProps): ReactNode {
  const { type, onTypeChange, disabled = false } = props;

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (!disabled) {
      setAnchorEl(event.currentTarget);
    }
  };

  const handleClose = (): void => {
    setAnchorEl(null);
  };

  const handleSelectType = (newType: string): void => {
    onTypeChange(newType);
    handleClose();
  };

  const IconComponent = STATE_TYPE_OPTIONS[type]?.icon ?? AbcIcon;

  return (
    <>
      <StateVariableIconButton
        tooltip={t('pipelines.flowEditor.state.selectDataType', 'Select data type')}
        onClick={handleClick}
        isActive={open}
        disabled={disabled}
      >
        <IconComponent
          width={ICON_SIZE}
          height={ICON_SIZE}
        />
      </StateVariableIconButton>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: menuPaperSx } }}
      >
        {Object.entries(STATE_TYPE_OPTIONS).map(([typeKey, typeConfig]) => {
          const MenuIconComponent = typeConfig.icon;
          const isSelected = type === typeKey;

          return (
            <MenuItem
              key={typeKey}
              selected={isSelected}
              onClick={() => handleSelectType(typeKey)}
              sx={menuItemSx(isSelected)}
            >
              <Box sx={menuItemContentSx}>
                <MenuIconComponent
                  width={ICON_SIZE}
                  height={ICON_SIZE}
                />
                <Typography
                  variant="bodyMedium"
                  color="text.secondary"
                >
                  {typeConfig.label}
                </Typography>
              </Box>
              {isSelected && (
                <CheckedIcon
                  width="0.75rem"
                  height="0.75rem"
                />
              )}
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}

const menuPaperSx: SxProps<Theme> = (theme: Theme) => ({
  marginTop: theme.spacing(1),
  width: '8.4375rem',
});

const menuItemContentSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1.5),
});

function menuItemSx(isSelected: boolean): SxProps<Theme> {
  return (theme: Theme) => ({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    justifyContent: 'space-between',
    ...(isSelected && {
      backgroundColor: theme.vars.palette.background.select.selected.default,
      '&.Mui-selected': {
        backgroundColor: theme.vars.palette.background.select.selected.default,
      },
      '&.Mui-selected:hover': {
        backgroundColor: theme.vars.palette.background.select.selected.hover,
      },
    }),
  });
}
