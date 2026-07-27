import type { ReactNode } from 'react';
import { useCallback, useId, useMemo } from 'react';

import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { combineSx } from '../lib/combineSx';
import { t } from '../lib/t';

/** @public A named point on the scale, shown as the mark's label when `showLabels` is set. */
export interface DiscreteSliderLevel {
  value: number;
  label: string;
}

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface DiscreteSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  /** Per-value labels, used for both the mark row (when `showLabels`) and the drag value bubble. */
  levels?: DiscreteSliderLevel[];
  label?: string;
  labelTooltip?: string;
  disabled?: boolean;
  /** Shows each `levels[value].label` under its mark instead of the bare number. */
  showLabels?: boolean;
  id?: string;
  sx?: SxProps<Theme>;
}

/**
 * A single-thumb, integer-step slider with one mark per step. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/slider/DiscreteSlider.jsx`.
 *
 * There is no `MuiSlider` entry in `shared/brand/mui-overrides/` (it is not
 * one of the 28 keys OWNERSHIP.md scoped to S1, and adding one is outside
 * this unit's brief — that directory is closed scope owned by S1/T1). This
 * component therefore renders MUI's `Slider` with no slot-level styling of
 * its own: R-T6 (`elitea/no-mui-internal-selector`) confines `.MuiSlider-*`
 * selectors to `shared/brand/mui-overrides/`, so the per-slot colours the
 * baseline hand-rolled (`sx={{ '& .MuiSlider-thumb': {...}, '& .MuiSlider-
 * mark': {...}, ... }}`) are not reproducible from this file at all, not
 * merely skipped for convenience.
 *
 * Two behavioural deviations, both accessibility improvements over the
 * baseline rather than parity gaps:
 *  - The baseline drew an invisible, absolutely-positioned `Tooltip`-wrapped
 *    `Box` over each mark purely to make marks click-to-set — duplicate,
 *    keyboard-inaccessible functionality layered on top of a native
 *    `Slider`, which already jumps to the nearest step (i.e. the nearest
 *    mark, since `step={1}`) on any click along the rail. Dropped rather
 *    than ported.
 *  - `levels[value].label` now drives MUI's own `valueLabelFormat` (the
 *    accessible, keyboard-reachable value bubble shown on focus/drag/hover)
 *    instead of a separate hover-only `Tooltip` per mark.
 *
 * R-C1 fix, not in the baseline: `label` is optional (the baseline's
 * `Label.InfoLabelWithTooltip` was always rendered, so it always doubled as
 * the slider's accessible name), and rendering a `Slider` with no `label`
 * and no fallback leaves the native range input with no accessible name at
 * all — caught by the a11y gate. A default `aria-label` ("Value") covers
 * that case; a real `label` always wins via `aria-labelledby`.
 */
export function DiscreteSlider({
  value,
  onChange,
  min = 1,
  max,
  levels,
  label,
  labelTooltip,
  disabled,
  showLabels,
  id,
  sx,
}: DiscreteSliderProps): ReactNode {
  const generatedId = useId();
  const labelId = id ?? `discrete-slider-${generatedId}-label`;

  const marks = useMemo(() => {
    const count = max - min + 1;
    return Array.from({ length: count }, (_, index) => {
      const markValue = min + index;
      const levelLabel = levels?.find((level) => level.value === markValue)?.label;
      return { value: markValue, label: showLabels && levelLabel ? levelLabel : String(markValue) };
    });
  }, [min, max, levels, showLabels]);

  const formatValueLabel = useCallback(
    (sliderValue: number) => levels?.find((level) => level.value === sliderValue)?.label ?? String(sliderValue),
    [levels],
  );

  const handleChange = useCallback(
    (_event: Event, newValue: number | number[]) => {
      if (typeof newValue === 'number') {
        onChange(newValue);
      }
    },
    [onChange],
  );

  const labelNode = label && (
    <Typography
      id={labelId}
      variant="subtitle"
      color={disabled ? 'text.disabled' : 'text.primary'}
    >
      {label}
    </Typography>
  );

  return (
    <Box sx={combineSx(containerSx, sx)}>
      {labelNode &&
        (labelTooltip ? (
          <Tooltip
            title={labelTooltip}
            placement="top"
          >
            <Box sx={inlineBlockSx}>{labelNode}</Box>
          </Tooltip>
        ) : (
          labelNode
        ))}
      <Slider
        value={value}
        onChange={handleChange}
        min={min}
        max={max}
        step={1}
        marks={marks}
        disabled={disabled}
        valueLabelDisplay="auto"
        valueLabelFormat={formatValueLabel}
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : t('shared.ui.discreteSlider.ariaLabel', 'Value')}
      />
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(2),
  width: '100%',
});

const inlineBlockSx: SxProps<Theme> = {
  display: 'inline-block',
};
