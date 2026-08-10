/**
 * Preset dropdown — react-js-cron's default `shortcuts` picker, ported (see
 * `presets.ts` for the shortcut-to-expression mapping and provenance).
 */
import type { JSX } from 'react';

import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import type { SelectChangeEvent } from '@mui/material/Select';
import Select from '@mui/material/Select';

import { t } from '@/shared/i18n';
import { applyPresetSelection, CRON_PRESETS, CUSTOM_PRESET_VALUE, presetLabel } from './presets';

export interface CronPresetSelectProps {
  readonly activePresetId: string | null;
  readonly onSelect: (expression: string) => void;
  readonly disabled?: boolean;
}

const PRESET_LABEL_ID = 'cron-preset-label';

export function CronPresetSelect(props: CronPresetSelectProps): JSX.Element {
  const { activePresetId, onSelect, disabled = false } = props;
  const label = t('shared.ui.cron.preset.label', 'Preset');

  const handleChange = (event: SelectChangeEvent<string>): void => {
    applyPresetSelection(event.target.value, onSelect);
  };

  return (
    <FormControl size="small" disabled={disabled} sx={{ minWidth: 220 }}>
      <InputLabel id={PRESET_LABEL_ID}>{label}</InputLabel>
      <Select<string>
        labelId={PRESET_LABEL_ID}
        id="cron-preset"
        label={label}
        value={activePresetId ?? CUSTOM_PRESET_VALUE}
        onChange={handleChange}
      >
        {CRON_PRESETS.map((preset) => (
          <MenuItem key={preset.id} value={preset.id}>
            {presetLabel(preset)}
          </MenuItem>
        ))}
        <MenuItem value={CUSTOM_PRESET_VALUE} disabled>
          {t('shared.ui.cron.preset.custom', 'Custom')}
        </MenuItem>
      </Select>
    </FormControl>
  );
}
