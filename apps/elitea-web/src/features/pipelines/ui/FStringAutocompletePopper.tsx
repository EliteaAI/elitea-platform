import type { ReactNode } from 'react';
import { memo } from 'react';

import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Paper from '@mui/material/Paper';
import Popper, { type PopperProps } from '@mui/material/Popper';
import type { SxProps, Theme } from '@mui/material/styles';

import { combineSx } from '@/shared/ui/lib/combineSx';
import type { FStringAutocompleteOption } from '../lib/fStringAutocomplete';

/** @public features/pipelines UI — the f-string (`{variable}`) suggestion dropdown. */
export interface FStringAutocompletePopperProps {
  readonly open: boolean;
  readonly anchorEl: PopperProps['anchorEl'];
  readonly options: readonly FStringAutocompleteOption[];
  readonly highlightedIndex: number;
  readonly onSelect: (value: string) => void;
  readonly popperSx?: SxProps<Theme>;
}

const popperStyle = {
  popper: (theme: Theme) => ({
    zIndex: theme.zIndex.modal + 1,
  }),
} satisfies Record<string, (theme: Theme) => SxProps<Theme>>;

const paperStyle: SxProps<Theme> = (theme) => ({
  marginTop: '0.5rem',
  border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
  // R-T10: radii come from the radiusSm|Md|Lg tokens. `theme.vars.shape.radiusMd`
  // is 8px (`default.pack.json`'s `shape.radiusMd`) — the same 0.5rem the
  // baseline hardcoded.
  borderRadius: theme.vars.shape.radiusMd,
  background: theme.vars.palette.background.secondary,
  maxHeight: '14rem',
  minWidth: '12rem',
  overflowY: 'auto',
});

const optionStyle: SxProps<Theme> = (theme) => ({
  padding: '0.5rem 1rem',
  minHeight: '2.5rem',
  // R-T11: fontSize comes from a typography variant. `bodyMedium`'s size is
  // 0.875rem (`typography.ts`'s step-0 row) — the same value the baseline
  // hardcoded.
  fontSize: theme.typography.bodyMedium.fontSize,
  color: theme.vars.palette.text.primary,
  '&:hover': {
    backgroundColor: theme.vars.palette.background.select.hover,
  },
  '&.Mui-selected': {
    backgroundColor: theme.vars.palette.background.select.hover,
  },
  '&.Mui-selected:hover': {
    backgroundColor: theme.vars.palette.background.select.hover,
  },
});

/**
 * The dropdown listing f-string variable suggestions, anchored under the
 * caret while a pipeline YAML/prompt input's `{...}` autocomplete is open.
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * fstring-autocomplete/ui/FStringAutocompletePopper.jsx` (baseline, 76
 * lines) — a stateless renderer driven entirely by
 * `useFStringAutocomplete`'s/`useFStringInputAutocomplete`'s state
 * (`open`/`anchorEl`/`options`/`highlightedIndex`) and callback
 * (`onSelect`) props, unchanged.
 *
 * `sx` callbacks read `theme.vars.palette.*` (R-T7 — live CSS-variable
 * references, scheme-aware with no JS mode branch) in place of the
 * baseline's plain `palette.*` reads, matching every other ported
 * component's MUI-theme convention in this app.
 */
export const FStringAutocompletePopper = memo(function FStringAutocompletePopper({
  open,
  anchorEl,
  options,
  highlightedIndex,
  onSelect,
  popperSx,
}: FStringAutocompletePopperProps): ReactNode {
  return (
    <Popper
      open={open}
      anchorEl={anchorEl}
      placement="bottom-start"
      sx={combineSx(popperStyle.popper, popperSx)}
    >
      <Paper
        elevation={0}
        sx={paperStyle}
        data-testid="fstring-autocomplete-popper"
      >
        <MenuList
          dense
          disablePadding
        >
          {options.map((option, index) => (
            <MenuItem
              key={option.value}
              selected={index === highlightedIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(option.value)}
              sx={optionStyle}
              data-testid="fstring-autocomplete-option"
            >
              {option.label}
            </MenuItem>
          ))}
        </MenuList>
      </Paper>
    </Popper>
  );
});
