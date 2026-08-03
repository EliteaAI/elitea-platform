/**
 * Secret value display cell with show/hide toggle and copy button.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/secrets/
 * SecretValueCell.jsx`.  The old app fetched the plaintext on-click via
 * RTK Query's `useLazySecretShowQuery`; the new version uses the
 * `showSecret` API directly (caller manages the mutation/query lifecycle).
 *
 * Deviation: the old app dispatched a toast after copy.  Toasts are a
 * page-level concern — this component only performs the copy and calls
 * the `onCopy` callback, which the page component uses to trigger the
 * toast.
 */
import { memo, useCallback } from 'react';

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { handleCopy } from '@/shared/lib/clipboard';
import { t } from '@/shared/ui/lib/t';

export interface SecretValueCellProps {
  /** Masked / placeholder display text. */
  label: string;
  /** Plaintext value (shown when visible). */
  value: string;
  /** Whether the plaintext is currently shown. */
  isVisible: boolean;
  /** Copy plaintext to clipboard — caller triggers toast. */
  onCopy: () => Promise<void>;
  /** Toggle visibility — caller manages state. */
  onToggleVisibility: () => void;
}

export const SecretValueCell = memo(function SecretValueCell({
  label,
  value,
  isVisible,
  onCopy,
  onToggleVisibility,
}: SecretValueCellProps) {
  const displayText = isVisible ? value : label;

  const handleCopyValue = useCallback(async () => {
    try {
      await handleCopy(displayText);
      await onCopy();
    } catch {
      // Copy failed — caller provides toast
    }
  }, [displayText, onCopy]);

  return (
    <Box sx={styles.container}>
      <Typography
        variant="bodyMedium"
        color="text.secondary"
        sx={styles.text}
        noWrap
      >
        {displayText || '-'}
      </Typography>
      <Tooltip title={isVisible ? t('entities.secret.value.hide', 'Hide') : t('entities.secret.value.show', 'Show')}>
        <IconButton
          size="small"
          color="tertiary"
          onClick={onToggleVisibility}
          sx={styles.icon}
        >
          {isVisible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
      <Tooltip title={t('entities.secret.value.copy', 'Copy')}>
        <IconButton
          size="small"
          color="tertiary"
          onClick={() => void handleCopyValue()}
          sx={styles.icon}
        >
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
});

const styles: Record<string, SxProps<Theme>> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    width: '100%',
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  icon: {
    padding: '0.25rem',
    minWidth: 0,
  },
};
