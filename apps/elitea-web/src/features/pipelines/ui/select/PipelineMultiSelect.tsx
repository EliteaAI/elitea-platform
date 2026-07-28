import type { ReactNode } from 'react';
import { useCallback, useId } from 'react';

import CheckIcon from '@mui/icons-material/Check';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem, { type MenuItemProps } from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';

/**
 * Local multi-value select, built for this sub-unit (A2h)'s owned
 * `ui/select/` pickers -- `InputSelect.jsx`, `OutputSelect.jsx`,
 * `RouteSelect.jsx`, `LLMToolsSelect.jsx`, `ToolkitsSelect.jsx` all render
 * the baseline's `Select.SingleSelect` with `multiple` (old app:
 * `apps/elitea-ui/src/[fsd]/shared/ui/select/SingleSelect.jsx`'s
 * multi-value branch, chip display + per-chip delete + "not in the known
 * options list" entries).
 *
 * **Real, disclosed gap this component works around:** this app's already-
 * landed `shared/ui/SingleSelect` (unit S1-D) is single-value ONLY --
 * "This port keeps the single-value case only... The 12-prop budget would
 * also have forced grouping most of the dropped surface into option
 * objects even if it were in scope" (`shared/ui/SingleSelect/SingleSelect.tsx`'s
 * own doc comment, read directly). No multi-select primitive exists
 * anywhere in `shared/ui` (confirmed: no `Multi`-prefixed component and no
 * `multiple` prop hit anywhere under `shared/ui`). `shared/ui/SingleSelect` is out of
 * this sub-unit's owned-file list (unit S1-D's), so it cannot be extended
 * here -- this is a feature-local primitive instead, built directly on MUI
 * `Select`/`Chip`/`MenuItem` the same way `shared/ui/SingleSelect` itself
 * is, kept local to `ui/select/` because its option shape (`canDelete`,
 * `tooltip`, `icon`) is specific to what these five baseline pickers need.
 */
export interface PipelineMultiSelectOption {
  readonly value: string;
  readonly label: string;
  readonly icon?: ReactNode;
  /** An option synthesised for a value already selected but absent from the "real" options list (baseline: `optionsNotInState`). */
  readonly canDelete?: boolean;
  readonly tooltip?: string;
}

export interface PipelineMultiSelectProps {
  readonly label?: string;
  readonly value: readonly string[];
  readonly onValueChange: (next: string[]) => void;
  readonly options: readonly PipelineMultiSelectOption[];
  readonly disabled?: boolean | undefined;
  /** Called instead of `onValueChange` when a chip's delete affordance is clicked, if provided (baseline: `onDeleteOption`). */
  readonly onDeleteOption?: (deletedValue: string) => void;
  readonly className?: string;
  readonly sx?: SxProps<Theme>;
  readonly 'data-testid'?: string;
}

const formControlSx: SxProps<Theme> = { minWidth: '10rem' };

const chipsContainerSx: SxProps<Theme> = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.25rem',
};

const chipSx: SxProps<Theme> = (theme: Theme) => ({
  height: '1.375rem',
  borderRadius: theme.vars.shape.radiusSm,
  backgroundColor: theme.vars.palette.background.userInputBackground,
});

function renderChips(
  selected: readonly string[],
  options: readonly PipelineMultiSelectOption[],
  onDelete: (value: string) => void,
): ReactNode {
  if (selected.length === 0) {
    return (
      <Typography
        variant="labelMedium"
        color="text.secondary"
        component="em"
      >
        {t('pipelines.select.placeholder', 'None')}
      </Typography>
    );
  }

  return (
    <Box sx={chipsContainerSx}>
      {selected.map(optionValue => {
        const option = options.find(candidate => candidate.value === optionValue);
        const chip = (
          <Chip
            key={optionValue}
            size="small"
            label={option?.label ?? optionValue}
            icon={option?.icon as React.ReactElement | undefined}
            sx={chipSx}
            onMouseDown={event => event.stopPropagation()}
            onDelete={() => onDelete(optionValue)}
          />
        );
        return option?.tooltip ? (
          <Tooltip
            key={optionValue}
            title={option.tooltip}
          >
            {chip}
          </Tooltip>
        ) : (
          chip
        );
      })}
    </Box>
  );
}

interface PipelineMultiSelectMenuItemProps extends Omit<MenuItemProps, 'children'> {
  readonly option: PipelineMultiSelectOption;
  readonly isSelected: boolean;
}

/**
 * One dropdown row: optional icon, label, trailing checkmark when selected.
 * Split out to keep {@link PipelineMultiSelect} under the §3.5 complexity
 * budget.
 *
 * Extends (and forwards) `MenuItemProps`, NOT a closed `{option, isSelected}`
 * prop set -- MUI's `Select` clones `onClick`/`selected`/`role`/`tabIndex`/
 * etc. onto each of its DIRECT children AND reads `child.props.value`
 * directly off that same direct child (not off any prop nested inside a
 * wrapper prop) to build its `SelectChangeEvent` (verified against the
 * installed `@mui/material@9.2.0` `Select/SelectInput.js` -- a `value` prop
 * declared only on the inner `<MenuItem>` two levels down is invisible to
 * it, and every click resolves to `undefined`). `value` is therefore passed
 * BOTH on `<PipelineMultiSelect>`'s own JSX call site (below, so `Select`
 * finds it) and on the inner `<MenuItem>` (so MUI's a11y/keyboard-nav
 * wiring, which reads the rendered DOM node's own `value`, works too). Same
 * rationale `shared/ui/SingleSelectMenuItem.tsx`'s doc comment documents
 * for its own `onClick`/`selected` forwarding (that component IS the
 * direct child, so it does not hit this extra `value`-visibility wrinkle).
 */
function PipelineMultiSelectMenuItem({ option, isSelected, value, ...rest }: PipelineMultiSelectMenuItemProps): ReactNode {
  return (
    <MenuItem
      value={value}
      {...rest}
    >
      {option.icon && <ListItemIcon>{option.icon}</ListItemIcon>}
      <ListItemText primary={option.label} />
      {isSelected && (
        <ListItemIcon sx={{ minWidth: 'auto', marginLeft: '0.5rem' }}>
          <CheckIcon fontSize="small" />
        </ListItemIcon>
      )}
    </MenuItem>
  );
}

/**
 * Multi-value select with removable chips. Baseline behaviour preserved:
 * values present in `value` but absent from `options` still render (as a
 * chip, via the caller synthesising a `canDelete: true` option entry --
 * see `InputSelect.tsx`/`OutputSelect.tsx`/`RouteSelect.tsx`'s own
 * `realInputOptions`/`realNodeOptions` computation, ported verbatim from
 * the baseline's identical pattern).
 */
export function PipelineMultiSelect(props: PipelineMultiSelectProps): ReactNode {
  const { label, value, onValueChange, options, disabled, onDeleteOption, className, sx, ...rest } = props;
  const generatedId = useId();
  const selectId = `pipeline-multi-select-${generatedId}`;
  const labelId = `${selectId}-label`;
  const dataTestId = rest['data-testid'];

  const handleChange = useCallback(
    (event: SelectChangeEvent<string[]>) => {
      const next = event.target.value;
      onValueChange(typeof next === 'string' ? next.split(',') : next);
    },
    [onValueChange],
  );

  const handleDelete = useCallback(
    (deletedValue: string) => {
      if (onDeleteOption) {
        onDeleteOption(deletedValue);
      } else {
        onValueChange(value.filter(item => item !== deletedValue));
      }
    },
    [onDeleteOption, onValueChange, value],
  );

  return (
    <FormControl
      fullWidth
      disabled={disabled}
      size="small"
      variant="standard"
      className={className}
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
        multiple
        labelId={label ? labelId : undefined}
        id={selectId}
        value={[...value]}
        label={label}
        displayEmpty
        data-testid={dataTestId}
        onChange={handleChange}
        renderValue={selected => renderChips(selected, options, handleDelete)}
      >
        {options.length === 0 ? (
          <MenuItem
            value=""
            disabled
          >
            {t('pipelines.select.empty', 'No options')}
          </MenuItem>
        ) : (
          options.map(option => (
            <PipelineMultiSelectMenuItem
              key={option.value}
              value={option.value}
              option={option}
              isSelected={value.includes(option.value)}
            />
          ))
        )}
      </Select>
    </FormControl>
  );
}
