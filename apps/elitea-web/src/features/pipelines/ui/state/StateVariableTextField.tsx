/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * state/StateVariableTextField.jsx` (78 lines) — unit A2j. The bare `TextField`
 * used for a state variable's editable name.
 *
 * `borderRadius: spacing(1)` -> `theme.vars.shape.radiusMd` (R-T10; 8px is an
 * exact match). `width`/`height` stay literal rem (box dimensions, not
 * R-T9's margin/padding/gap scope). `variant="standard"` is not set here —
 * the baseline used the default `outlined` variant (visible via its own
 * `MuiOutlinedInput-notchedOutline` selector target), reproduced with the
 * same default here.
 *
 * The baseline's four literal `.MuiInputBase-*`/`.MuiOutlinedInput-*`
 * selectors are R-T6-banned outside `shared/brand/mui-overrides/`. Rebuilt
 * with `inputBaseClasses`/`outlinedInputClasses` computed member
 * expressions instead — the exact same "class-constant, not a literal
 * string" substitution this codebase already uses for `@mui/x-data-grid`'s
 * `gridClasses` (see `./StateVariableTable.tsx`).
 *
 * `autoFocus` (baseline: a caller-controlled prop, driven by `./
 * StateVariableItem.tsx`'s create/edit-start moment) is dropped from this
 * component's own props entirely — `jsx-a11y/no-autofocus` bans it outright
 * with no per-file waiver, same fix `./StateVariableItem.tsx`'s own doc
 * comment documents at its one call site.
 */
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';

import { inputBaseClasses } from '@mui/material/InputBase';
import { outlinedInputClasses } from '@mui/material/OutlinedInput';
import TextField from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';

/** @public */
export interface StateVariableTextFieldProps {
  readonly value: string;
  readonly onChange?: ((event: ChangeEvent<HTMLInputElement>) => void) | undefined;
  readonly onBlur?: (() => void) | undefined;
  readonly onKeyDown?: ((event: KeyboardEvent<HTMLInputElement>) => void) | undefined;
  readonly error?: boolean | undefined;
  readonly placeholder?: string | undefined;
  readonly width?: string | undefined;
  readonly disabled?: boolean | undefined;
}

export function StateVariableTextField(props: StateVariableTextFieldProps): ReactNode {
  const { value, onChange, onBlur, onKeyDown, error = false, placeholder = '', width = '10.125rem', disabled } = props;

  return (
    <TextField
      value={value}
      onChange={onChange}
      onBlur={!disabled ? onBlur : undefined}
      onKeyDown={!disabled ? onKeyDown : undefined}
      size="small"
      error={error}
      placeholder={placeholder}
      sx={textFieldSx(error, width)}
      disabled={disabled}
    />
  );
}

function textFieldSx(hasError: boolean, width: string): SxProps<Theme> {
  return (theme: Theme) => ({
    width,
    minWidth: width,
    [`& .${inputBaseClasses.root}`]: {
      height: theme.spacing(4),
      padding: `${theme.spacing(0.5)} ${theme.spacing(1.25)}`,
      borderRadius: theme.vars.shape.radiusMd,
      background: theme.vars.palette.background.userInputBackground,
      color: theme.vars.palette.text.secondary,
    },
    [`& .${outlinedInputClasses.notchedOutline}`]: {
      borderColor: hasError ? theme.vars.palette.error.main : 'transparent',
      borderWidth: '.0625rem',
    },
    [`& .${inputBaseClasses.root}:hover .${outlinedInputClasses.notchedOutline}`]: {
      borderColor: hasError ? theme.vars.palette.error.main : theme.vars.palette.border.lines,
      borderWidth: '.0625rem',
    },
    [`& .${inputBaseClasses.root}.Mui-focused .${outlinedInputClasses.notchedOutline}`]: {
      borderColor: hasError ? theme.vars.palette.error.main : theme.vars.palette.primary.main,
      borderWidth: '.0625rem',
    },
    [`& .${inputBaseClasses.input}`]: {
      padding: 0,
      color: theme.vars.palette.text.secondary,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    [`& .${inputBaseClasses.input}::placeholder`]: {
      color: theme.vars.palette.secondary.main,
      opacity: 1,
    },
  });
}
