/**
 * SoundNotificationControls — volume slider + toggle for sound notifications.
 */
import { memo, useCallback } from 'react';

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';

import { BaseBtn } from '@/shared/ui/BaseBtn';
import { BaseSwitch } from '@/shared/ui/BaseSwitch';
import { DiscreteSlider } from '@/shared/ui/DiscreteSlider';

import { type UseSoundNotificationResult } from '@/shared/lib/hooks/useSoundNotification';
import { t } from '@/shared/ui/lib/t';

const VOLUME_MARKS = [
  { value: 0, label: '0%' },
  { value: 0.5, label: '50%' },
  { value: 1, label: '100%' },
];

export interface SoundNotificationControlsProps {
  config: UseSoundNotificationResult['config'];
  setConfig: UseSoundNotificationResult['setConfig'];
  playCompletionSound: () => void;
}

export const SoundNotificationControls = memo(
  ({ config, setConfig, playCompletionSound }: SoundNotificationControlsProps) => {
    const handleToggle = useCallback(
      (_event: React.ChangeEvent<HTMLInputElement>, checkedValue: boolean) => {
        setConfig({ enabled: checkedValue });
      },
      [setConfig],
    );

    const handleVolumeChange = useCallback(
      (value: number) => {
        setConfig({ volume: Math.max(0, Math.min(1, value)) });
      },
      [setConfig],
    );

    return (
      <Box sx={styles.content}>
        <FormControlLabel
          control={
            <BaseSwitch
              checked={config.enabled}
              onChange={handleToggle}
              slotProps={{
                input: {
                  'aria-label': 'Play sound when tasks complete',
                },
              }}
            />
          }
          label={t('settings.playSoundOnComplete', 'Play sound when tasks complete')}
        />
        {config.enabled && (
          <Box sx={styles.sliderRow}>
            <Typography variant="caption" sx={styles.sliderLabel}>
              {t('settings.volume', 'Volume')}
            </Typography>
            <DiscreteSlider
              value={config.volume}
              onChange={handleVolumeChange}
              min={0}
              max={1}
              levels={VOLUME_MARKS}
            />
          </Box>
        )}
        {config.enabled && (
          <Box>
            <BaseBtn variant="elitea" color="secondary" onClick={playCompletionSound}>
              {t('settings.previewSound', 'Preview Sound')}
            </BaseBtn>
          </Box>
        )}
      </Box>
    );
  },
);

SoundNotificationControls.displayName = 'SoundNotificationControls';

const styles = {
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  sliderRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    px: '0.25rem',
  },
  sliderLabel: {
    color: 'text.secondary',
  },
};
