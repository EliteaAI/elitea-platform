/**
 * EnableToggleCard — toggle card for enabling/disabling project context.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/project-context/EnableToggleCard.jsx`.
 */
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { BaseSwitch } from '@/shared/ui/BaseSwitch';
import { t } from '@/shared/i18n';

export interface EnableToggleCardProps {
  enabled: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
}

export function EnableToggleCard({
  enabled,
  onToggle,
  disabled = false,
}: EnableToggleCardProps) {
  const sx = cardStyles();
  return (
    <Box sx={sx.card}>
      <Box sx={sx.text}>
        <Typography
          variant="headingSmall"
          color="text.secondary"
        >
          {t('entities.projectContext.enableToggleCard.title', 'Project Context')}
        </Typography>
        <Typography variant="bodySmall">
          {t(
            'entities.projectContext.enableToggleCard.description',
            'Project-specific background information that the AI uses to generate more accurate and relevant responses, tailored to your workflows, data, and goals.',
          )}
        </Typography>
      </Box>
      <BaseSwitch
        checked={enabled}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onToggle(e.target.checked)}
        color="primary"
        disabled={disabled}
      />
    </Box>
  );
}

function cardStyles(): Record<string, SxProps<Theme>> {
  return {
    card: ({ palette }) => ({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '1rem 1.5rem',
      borderRadius: '0.75rem',
      backgroundColor: palette.background.userInputBackground,
      gap: '1rem',
    }),
    text: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
    },
  };
}
