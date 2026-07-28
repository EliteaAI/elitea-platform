import type { ReactNode } from 'react';
import { useCallback } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import type { SxProps, Theme } from '@mui/material/styles';
import SvgIcon from '@mui/material/SvgIcon';
import Typography from '@mui/material/Typography';

import { BaseCheckbox } from '@/shared/ui/BaseCheckbox';
import { RemoveIcon } from '@/shared/ui/icons/remove-icon';

/** One selectable option, matching `SingleSelectOption`'s `{label, value}` shape (`@/shared/ui/SingleSelectMenuItem`) without importing it, since this is a `Select multiple` checklist, not a `SingleSelect`. */
interface EnumMultiSelectOption {
  readonly label: string;
  readonly value: string;
}

/** @public features/pipelines UI — a multi-value enum picker rendered as removable chips, for `InputMappingItem`'s `dataType === 'array'` + fixed-enum branch. */
export interface EnumMultiSelectFieldProps {
  readonly label: ReactNode;
  readonly value: readonly string[];
  readonly options: readonly EnumMultiSelectOption[];
  readonly onChange: (value: string[]) => void;
  readonly disabled?: boolean | undefined;
}

/**
 * Ported from the multi-value branch of `apps/elitea-ui/src/[fsd]/shared/
 * ui/select/SingleSelect.jsx` (baseline, 847 lines — `multiple`/
 * `renderMultipleValue`/`handleDeleteChip`, lines 68/176-238), the ONE
 * baseline interaction `InputMappingItem.jsx`'s
 * `dataType === 'array' && type !== 'variable'` branch actually exercises
 * (`Select.SingleSelect ... multiple`, baseline `InputMappingItem.jsx`
 * lines 339-349).
 *
 * NOT a promotion or a reduced port of the full `SingleSelect.jsx`: this
 * app's already-ported `shared/ui/SingleSelect` (unit S1-D) explicitly
 * scopes itself to the single-value case only ("This port keeps the
 * single-value case only", its own doc comment) — extending it with
 * `multiple` support is out of this sub-unit's owned-file list (it would
 * mean editing a `shared/ui` file A2i does not own). This is therefore a
 * small, local, feature-owned component built directly on MUI's own
 * `Select multiple` + `Chip`, reproducing just the baseline interaction
 * this one call site needs (chips with a delete affordance, a checklist
 * dropdown) — not a general-purpose replacement for `SingleSelect`.
 */
export function EnumMultiSelectField({ label, value, options, onChange, disabled }: EnumMultiSelectFieldProps): ReactNode {
  const handleSelectChange = useCallback(
    (event: SelectChangeEvent<string[]>) => {
      const next = event.target.value;
      onChange(typeof next === 'string' ? next.split(',') : next);
    },
    [onChange],
  );

  const handleDeleteChip = useCallback(
    (deletedValue: string) => {
      onChange(value.filter((v) => v !== deletedValue));
    },
    [value, onChange],
  );

  return (
    <FormControl
      fullWidth
      variant="standard"
      disabled={disabled}
      sx={formControlSx}
    >
      <InputLabel shrink>{label}</InputLabel>
      <Select<string[]>
        multiple
        variant="standard"
        value={[...value]}
        onChange={handleSelectChange}
        renderValue={(selected) => (
          <Box sx={chipsRowSx}>
            {selected.map((selectedValue) => {
              const found = options.find((option) => option.value === selectedValue);
              if (!found) return null;
              return (
                <Chip
                  key={selectedValue}
                  data-testid="enum-multi-select-chip"
                  label={
                    <Typography
                      variant="labelSmall"
                      color="text.secondary"
                    >
                      {found.label}
                    </Typography>
                  }
                  deleteIcon={
                    <SvgIcon
                      component={RemoveIcon}
                      inheritViewBox
                      sx={deleteIconSx}
                      data-testid="enum-multi-select-chip-delete"
                    />
                  }
                  onDelete={disabled ? undefined : () => handleDeleteChip(selectedValue)}
                  onMouseDown={(event) => event.stopPropagation()}
                  sx={chipSx}
                />
              );
            })}
          </Box>
        )}
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            value={option.value}
          >
            <BaseCheckbox
              checked={value.includes(option.value)}
              size="small"
            />
            <ListItemText primary={option.label} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

const formControlSx: SxProps<Theme> = {
  minWidth: '10rem',
};

const chipsRowSx: SxProps<Theme> = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.25rem',
  padding: '0 0 0.375rem',
};

/**
 * R-T6 (`no-mui-internal-selector`) bans reaching into a MUI component's
 * internal chip-delete-icon classes from outside `shared/brand/
 * mui-overrides/` — the baseline's own hover-colour transition on that
 * descendant element (`SingleSelect.jsx`'s `styles.chip`) has no legal
 * equivalent here. The chip's own background still comes from the
 * `tagChip` token set (below); the label/delete-icon colours are set
 * directly on THOSE elements instead (`Typography color`/`SvgIcon sx`
 * above), which needs no descendant selector at all — a fixed colour
 * rather than a hover transition, but the same token family.
 */
const chipSx: SxProps<Theme> = (theme: Theme) => ({
  background: theme.vars.palette.background.tagChip.disabled,
});

const deleteIconSx: SxProps<Theme> = (theme: Theme) => ({
  color: theme.vars.palette.icon.tagChip.default,
});
