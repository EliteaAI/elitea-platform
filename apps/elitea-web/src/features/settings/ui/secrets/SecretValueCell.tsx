/**
 * Secret value display cell with show/hide toggle and copy button.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/secrets/
 * SecretValueCell.jsx`.  The old app always fetched the plaintext fresh
 * on copy-click via RTK Query's `useLazySecretShowQuery`, regardless of
 * whether the value was currently shown/masked — this component preserves
 * that: it never copies its own local `displayText`, it only calls the
 * caller-supplied `onCopy`, which is responsible for fetching the live
 * plaintext and performing the actual clipboard write (see
 * `pages/settings/Secrets.tsx`'s `onCopySecretValue`).
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

import { t } from '@/shared/i18n';

export interface SecretValueCellProps {
  /** Masked / placeholder display text. */
  label: string;
  /** Plaintext value (shown when visible). */
  value: string;
  /** Whether the plaintext is currently shown. */
  isVisible: boolean;
  /** Fetches the live plaintext and copies it to the clipboard — caller manages the fetch/mutation lifecycle and any toast. */
  onCopy: () => Promise<void>;
  /** Toggle visibility — caller manages state. */
  onToggleVisibility: () => void;
  /** Gates the show/hide toggle behind `PERMISSIONS.secrets.unsecret` — omit the button entirely when the caller lacks that permission (matches the baseline's `checkPermission(PERMISSIONS.secrets.unsecret)` guard, `SecretsTable.jsx:492`). */
  canToggleVisibility: boolean;
  /**
   * Gates the COPY button on the same `PERMISSIONS.secrets.unsecret` (#402).
   *
   * Copy is not a clipboard operation over what is already on screen. `onCopy`
   * re-fetches the live plaintext through
   * `GET /api/v2/secrets/secret/default/{projectID}/{name}`, which is the route
   * `.unsecret` gates. Without the permission it answers 403 and the user gets
   * "Failed to copy to clipboard", which names the wrong cause.
   */
  canCopy: boolean;
}

export const SecretValueCell = memo(function SecretValueCell({
  label,
  value,
  isVisible,
  onCopy,
  onToggleVisibility,
  canToggleVisibility,
  canCopy,
}: SecretValueCellProps) {
  const displayText = isVisible ? value : label;

  const handleCopyValue = useCallback(async () => {
    try {
      await onCopy();
    } catch {
      // Copy failed — caller provides toast
    }
  }, [onCopy]);

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
      {canToggleVisibility && (
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
      )}
      {canCopy && (
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
      )}
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
