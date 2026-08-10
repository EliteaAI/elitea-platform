import type { ChangeEvent, ReactNode } from 'react';
import { useCallback } from 'react';

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';

import { BaseCheckbox } from '../BaseCheckbox';
import { InfoLabelWithTooltip } from '../InfoLabelWithTooltip';
import { t } from '@/shared/i18n';

/** @public shared/ui component API. */
export interface RadioButtonGroupItem {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  /** Rendered as an info-icon tooltip next to `label` (composes `InfoLabelWithTooltip`). */
  info?: ReactNode;
  disabled?: boolean;
}

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface RadioButtonGroupProps {
  value?: string;
  defaultValue?: string;
  onChange: (value: string) => void;
  items: readonly RadioButtonGroupItem[];
  wrapRow?: boolean;
  columnGap?: string;
  disabled?: boolean;
  /** The group's accessible name — see this component's doc comment for why it is required. */
  'aria-label'?: string;
}

/**
 * A row of labelled radio options, each with an optional description line
 * and an optional info-tooltip icon. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/checkbox/RadioButtonGroup.jsx`,
 * composing this unit's own `BaseCheckbox` (`mode="radio"`) and
 * `InfoLabelWithTooltip` rather than a bespoke label+icon layout — the
 * baseline hand-rolled both.
 *
 * Accessibility fix, not in the baseline: the baseline's `RadioGroup` sets
 * `aria-labelledby="radio-buttons-group-label"`, an id no element in the
 * component (or, in every baseline call site, its caller) actually carries
 * — axe's `aria-valid-attr-value` rule rejects an `aria-labelledby`
 * pointing at nothing, and the group is left with no accessible name
 * either way. `'aria-label'` is a real (optional) prop instead, applied
 * directly to the `RadioGroup`.
 */
export function RadioButtonGroup({
  value,
  defaultValue,
  onChange,
  items,
  wrapRow = false,
  columnGap,
  disabled,
  'aria-label': ariaLabel,
}: RadioButtonGroupProps): ReactNode {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.value);
    },
    [onChange],
  );

  return (
    <RadioGroup
      aria-label={ariaLabel ?? t('shared.ui.radioButtonGroup.groupLabel', 'Options')}
      defaultValue={defaultValue}
      name="radio-buttons-group"
      value={value}
      onChange={handleChange}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          rowGap: 0,
          columnGap: columnGap ?? '1.5rem',
          flexWrap: wrapRow ? 'wrap' : 'nowrap',
        }}
      >
        {items.map((item) => (
          <Box
            key={item.value}
            sx={{ display: 'flex', flexDirection: 'column' }}
          >
            <FormControlLabel
              sx={{ alignItems: 'flex-start', mb: '0.5rem' }}
              value={item.value}
              control={
                <BaseCheckbox
                  mode="radio"
                  disabled={item.disabled || disabled}
                />
              }
              label={
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <InfoLabelWithTooltip
                    label={item.label}
                    tooltip={item.info}
                    variant="bodyMedium"
                  />
                  {item.description !== undefined && (
                    <Typography
                      component="div"
                      variant="bodySmall"
                    >
                      {item.description}
                    </Typography>
                  )}
                </Box>
              }
            />
          </Box>
        ))}
      </Box>
    </RadioGroup>
  );
}
