/**
 * The onboarding screen's dead-end state, split out of `Onboarding.tsx` for the
 * §3.5 file-length budget.
 */
import { memo } from 'react';

import { Box, Typography } from '@mui/material';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';

import { styles } from './Onboarding.styles';

/**
 * What this screen shows when it cannot read the caller at all.
 *
 * The wait this page performs is a poll, and a poll that has stopped answering
 * is not a wait — it is a dead end. A spinner would claim the opposite.
 */
export const AuthorUnavailable = memo<{ onRetry: () => void }>(({ onRetry }) => (
  <Box sx={styles.errorContainer}>
    <Typography variant="bodyMedium" sx={theme => ({ color: theme.vars.palette.text.secondary })}>
      {t(
        'pages.onboarding.authorUnavailable',
        'We could not load your account just now.',
      )}
    </Typography>
    <BaseBtn variant="elitea" color="primary" onClick={onRetry}>
      {t('pages.onboarding.authorRetry', 'Try again')}
    </BaseBtn>
  </Box>
));

AuthorUnavailable.displayName = 'AuthorUnavailable';
