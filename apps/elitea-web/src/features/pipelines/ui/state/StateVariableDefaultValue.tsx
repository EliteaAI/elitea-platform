/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * state/StateVariableDefaultValue.jsx` (214 lines) — unit A2j. Renders a
 * state variable's default value as an inline field (wide drawer), an icon
 * button revealing a set value (narrow drawer, non-empty default), or an
 * "add default value" affordance (narrow drawer, empty default).
 *
 * `borderRadius: spacing(1)` -> `theme.vars.shape.radiusMd` (R-T10, exact
 * match). The baseline's four literal `.MuiInputBase-*`/
 * `.MuiOutlinedInput-*` selectors are rebuilt with `inputBaseClasses`/
 * `outlinedInputClasses` computed keys, same substitution as
 * `./StateVariableTextField.tsx`. `-webkit-line-clamp` (baseline: a
 * collapsed-text CSS clamp on `.MuiInputBase-input`) is real content
 * truncation, not a banned internal-selector concern by itself — kept, just
 * rekeyed off `inputBaseClasses.input`.
 */
import type { ChangeEvent, ReactNode } from 'react';
import { useMemo } from 'react';

import Box from '@mui/material/Box';
import { inputBaseClasses } from '@mui/material/InputBase';
import { outlinedInputClasses } from '@mui/material/OutlinedInput';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';

import { StateDrawerConstants } from '../../lib/flow-editor/constants';
import { convertValueByType, getDefaultValueForType } from '../../lib/flow-editor/helpers/state.helpers';
import { FullScreenIcon } from '@/shared/ui/icons/full-screen-icon';
import { PlusIcon } from '@/shared/ui/icons/plus-icon';
import { SlidersIcon } from '@/shared/ui/icons/sliders-icon';
import { t } from '@/shared/i18n';

import { StateVariableIconButton } from './StateVariableIconButton';

/** @public */
export interface StateVariableDefaultValueProps {
  readonly drawerWidth?: number | undefined;
  readonly defaultValue?: unknown;
  readonly disabled?: boolean | undefined;
  readonly onIconClick?: (() => void) | undefined;
  readonly onChange?: ((event: ChangeEvent<HTMLInputElement>) => void) | undefined;
  readonly type: string;
}

export function StateVariableDefaultValue(props: StateVariableDefaultValueProps): ReactNode {
  const { drawerWidth = 300, defaultValue = '', disabled = false, onIconClick, onChange, type } = props;

  const showAsField = drawerWidth > StateDrawerConstants.DRAWER_BREAKPOINT_NARROW;
  const multiline = drawerWidth >= StateDrawerConstants.DRAWER_BREAKPOINT_EXPANDED;

  const hasDefaultValue = useMemo(() => {
    const typeDefault = getDefaultValueForType(type);
    return JSON.stringify(defaultValue) !== JSON.stringify(typeDefault);
  }, [defaultValue, type]);

  const handleBlur = (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    // Scroll to top when losing focus to show first 5 lines with ellipsis
    if (multiline) event.target.scrollTop = 0;
  };

  if (showAsField) {
    return (
      <Box sx={fieldContainerSx}>
        <TextField
          value={convertValueByType(type, defaultValue)}
          placeholder={t('pipelines.flowEditor.state.defaultValuePlaceholder', 'Default value')}
          disabled={disabled}
          size="small"
          multiline={multiline}
          maxRows={5}
          onChange={onChange}
          onBlur={handleBlur}
          sx={textFieldSx(multiline)}
        />
        {!disabled && onIconClick && (
          <Tooltip
            title={t('pipelines.flowEditor.state.fullScreenView', 'Full screen view')}
            placement="top"
          >
            <IconButton
              aria-label={t('pipelines.flowEditor.state.fullScreenView', 'Full screen view')}
              onClick={(event) => {
                event.stopPropagation();
                onIconClick();
              }}
              sx={fullScreenButtonSx}
              className="fullscreen-button"
            >
              <Box
                component={FullScreenIcon}
                sx={fullScreenIconSx}
              />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    );
  }

  if (hasDefaultValue) {
    return (
      <StateVariableIconButton
        tooltip={t('pipelines.flowEditor.state.defaultValueOptional', 'Default value (optional)')}
        disabled={disabled}
        onClick={onIconClick}
      >
        <Box
          component={SlidersIcon}
          sx={slidersIconSx}
        />
      </StateVariableIconButton>
    );
  }

  return (
    <Box sx={addButtonContainerSx}>
      <Tooltip
        title={t('pipelines.flowEditor.state.addDefaultValueOptional', 'Add default value (optional)')}
        placement="top"
      >
        <IconButton
          aria-label={t('pipelines.flowEditor.state.addDefaultValueOptional', 'Add default value (optional)')}
          disabled={disabled}
          onClick={onIconClick}
          sx={addButtonSx}
        >
          <Box
            component={PlusIcon}
            sx={addButtonIconSx}
          />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

const fieldContainerSx: SxProps<Theme> = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  '&:hover .fullscreen-button': {
    opacity: 1,
    pointerEvents: 'auto',
  },
};

function textFieldSx(multiline: boolean): SxProps<Theme> {
  return (theme: Theme) => ({
    flex: 1,
    minWidth: 0,
    [`& .${inputBaseClasses.root}`]: {
      minHeight: theme.spacing(4),
      height: multiline ? 'auto' : theme.spacing(4),
      padding: `${theme.spacing(0.5)} ${theme.spacing(4)} ${theme.spacing(0.5)} ${theme.spacing(1.25)}`,
      borderRadius: theme.vars.shape.radiusMd,
      background: theme.vars.palette.background.userInputBackground,
      color: theme.vars.palette.text.secondary,
      alignItems: multiline ? 'flex-start' : 'center',
      cursor: 'text',
    },
    [`& .${outlinedInputClasses.notchedOutline}`]: {
      borderColor: 'transparent',
      borderWidth: '.0625rem',
    },
    [`& .${inputBaseClasses.root}:hover .${outlinedInputClasses.notchedOutline}`]: {
      borderColor: theme.vars.palette.border.lines,
      borderWidth: '.0625rem',
    },
    [`& .${inputBaseClasses.root}.Mui-focused .${outlinedInputClasses.notchedOutline}`]: {
      borderColor: theme.vars.palette.primary.main,
      borderWidth: '.0625rem',
    },
    [`& .${inputBaseClasses.root}.Mui-disabled .${outlinedInputClasses.notchedOutline}`]: {
      borderColor: 'transparent',
      borderWidth: 0,
    },
    [`& .${inputBaseClasses.input}`]: {
      padding: 0,
      color: theme.vars.palette.text.secondary,
      cursor: 'text',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      display: multiline ? '-webkit-box' : 'block',
      WebkitLineClamp: multiline ? 5 : 'unset',
      WebkitBoxOrient: multiline ? 'vertical' : 'unset',
      lineHeight: multiline ? 1.5 : '1.5rem',
    },
    [`& .${inputBaseClasses.input}:focus`]: {
      display: 'block',
      WebkitLineClamp: 'unset',
      WebkitBoxOrient: 'unset',
    },
    [`& .${inputBaseClasses.input}::placeholder`]: {
      color: theme.vars.palette.secondary.main,
      opacity: 1,
    },
  });
}

// Baseline: `fontSize: spacing(1.8)` (14.4px = 0.9rem). `fontSize` is
// R-T11-banned as an ad-hoc literal (`tools/lint-rules/rules/
// ad-hoc-font-size.mjs`); `SlidersIcon` is a raw SVGR `<svg>` (not a
// `@mui/icons-material` glyph that scales off `font-size`), so `width`/
// `height` is both the lint-safe AND the actually-effective way to size it.
const slidersIconSx: SxProps<Theme> = { width: '0.9rem', height: '0.9rem' };

const addButtonContainerSx: SxProps<Theme> = (theme: Theme) => ({
  height: theme.spacing(4),
  width: theme.spacing(4),
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

const addButtonSx: SxProps<Theme> = (theme: Theme) => ({
  padding: theme.spacing(0.75),
  alignSelf: 'center',
});

const addButtonIconSx: SxProps<Theme> = { width: '1rem', height: '1rem' };

const fullScreenButtonSx: SxProps<Theme> = (theme: Theme) => ({
  position: 'absolute',
  right: theme.spacing(0.5),
  top: '50%',
  transform: 'translateY(-50%)',
  padding: theme.spacing(0.5),
  backgroundColor: 'transparent',
  opacity: 0,
  transition: 'opacity 0.2s ease',
  pointerEvents: 'none',
  '&:hover': {
    backgroundColor: 'transparent',
  },
});

const fullScreenIconSx: SxProps<Theme> = { width: '1rem', height: '1rem' };
