import type { ReactNode } from 'react';
import { useCallback, useId, useMemo } from 'react';

// [S1-D] Interim icon, same class of gap BaseModal.tsx documents for
// `CloseIcon`: the baseline's `ArrowDownIcon` (`@/components/Icons/
// ArrowDownIcon`) is not part of S2's ported `shared/ui/icons/` set (its
// 16x16 chevron path is not among the ported SVGs — verified: no icon file
// in `shared/ui/icons/svg/` matches that path data). `ExpandMore` is the
// standard @mui/icons-material chevron used as `Select`'s `IconComponent`
// (R-I1-compliant single-icon import).
// TODO(S2 follow-up): swap for `@/shared/ui/icons/arrow-down-icon` once it lands.
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { combineSx } from '../lib/combineSx';
import { t } from '../lib/t';
import { SingleSelectDropdown } from '../SingleSelectDropdown';
import type { SingleSelectOption } from '../SingleSelectMenuItem';

/**
 * @public shared/ui component API — consumed once a features/widgets/pages
 * caller exists (none does yet in this pass).
 *
 * `error` doubles as the error flag: a non-empty string switches the field
 * into its error state AND supplies the helper text shown below it.
 */
export interface SingleSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SingleSelectOption[];
  label?: string;
  /** Shown in place of the value when it matches no option (e.g. the initial `''`). */
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  /** Clicking the already-selected option calls this instead of a no-op reselect. */
  onClear?: () => void;
  name?: string;
  id?: string;
  sx?: SxProps<Theme>;
}

/**
 * A single-value select built on MUI's `Select`/`FormControl`/`InputLabel`,
 * styled entirely through `shared/brand/mui-overrides/{MuiSelect,MuiMenu,
 * MuiList,MuiMenuItem}.ts` (R-T12, already wired) plus this file's own
 * layout `sx`.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/shared/ui/select/SingleSelect.jsx`,
 * substantially trimmed. The baseline is a 50-prop component covering
 * multi-select with removable chips, grouped options with sticky headers,
 * an inline search bar, a "flat menu action" row, a remote-search loading
 * footer, and per-option avatars/custom renderers — each of those either
 * needs an app-level constant this layer-bottom `shared/ui` component
 * cannot import (`FLAT_MENU_ACTION_VALUE` from `@/[fsd]/shared/lib/
 * constants`) or a sibling `shared/ui` component this unit's scope does not
 * include (`SimpleSearchBar`, `InfoTooltip`, `Banner`). This port keeps the
 * single-value case only: one committed `value`, one `onChange`, an
 * optional `onClear` for "click the selected row again to clear" (the one
 * baseline interaction distinctive enough to be worth preserving on its
 * own). The 12-prop budget (§3.5) would also have forced grouping most of
 * the dropped surface into option objects even if it were in scope.
 *
 * Deviation: `variant="standard"` is hard-coded, not exposed as a prop —
 * `MuiSelect.ts`'s only styled variant is `'standard'` (T1/S1's wiring
 * note), so offering `'outlined'`/`'filled'` would render unstyled.
 */
export function SingleSelect({
  value,
  onChange,
  options,
  label,
  placeholder,
  disabled,
  required,
  error,
  onClear,
  name,
  id,
  sx,
}: SingleSelectProps): ReactNode {
  const generatedId = useId();
  const selectId = id ?? `single-select-${generatedId}`;
  const labelId = `${selectId}-label`;
  const hasMatch = useMemo(() => options.some((option) => option.value === value), [options, value]);

  const handleChange = useCallback(
    (event: SelectChangeEvent<string>) => {
      onChange(event.target.value);
    },
    [onChange],
  );

  const renderValue = useCallback(
    (selected: string) => {
      const found = options.find((option) => option.value === selected);
      if (!found) {
        return (
          <Typography
            variant="labelMedium"
            color="text.secondary"
            component="em"
          >
            {placeholder ?? t('shared.ui.singleSelect.placeholder', 'None')}
          </Typography>
        );
      }
      return (
        <Typography
          variant="labelMedium"
          color="inherit"
        >
          {found.label}
        </Typography>
      );
    },
    [options, placeholder],
  );

  return (
    <FormControl
      fullWidth
      required={required}
      error={Boolean(error)}
      disabled={disabled}
      size="small"
      variant="standard"
      sx={combineSx(formControlSx, sx)}
    >
      {label && (
        <InputLabel
          id={labelId}
          shrink
        >
          {label}
        </InputLabel>
      )}
      <Select
        variant="standard"
        labelId={label ? labelId : undefined}
        id={selectId}
        name={name}
        value={value}
        label={label}
        displayEmpty
        aria-label={label ? undefined : (placeholder ?? t('shared.ui.singleSelect.ariaLabel', 'Select an option'))}
        onChange={handleChange}
        renderValue={renderValue}
        IconComponent={ExpandMoreIcon}
      >
        {!hasMatch && (
          <MenuItem
            value=""
            sx={hiddenSx}
          />
        )}
        {options.length === 0 ? (
          <MenuItem
            value=""
            disabled
          >
            {t('shared.ui.singleSelect.empty', 'No options')}
          </MenuItem>
        ) : (
          options.map((option) => (
            <SingleSelectDropdown
              key={option.value}
              value={option.value}
              option={option}
              isSelected={option.value === value}
              {...(onClear ? { onClear } : {})}
            />
          ))
        )}
      </Select>
      {error && <FormHelperText>{error}</FormHelperText>}
    </FormControl>
  );
}

const formControlSx: SxProps<Theme> = {
  minWidth: '10rem',
};

const hiddenSx: SxProps<Theme> = {
  display: 'none',
};
