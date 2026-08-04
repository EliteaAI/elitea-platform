/**
 * Dialog that displays a freshly generated personal access token.
 * Shows a warning about single-use display and a copy button.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/personal-tokes/
 * GeneratedTokenDialog.jsx`.
 *
 * Deviations:
 *  - Uses `@/shared/ui/lib/t` for i18n
 *  - Uses MUI Dialog components directly
 *  - Uses `AttentionIcon` (existing in shared/ui/icons) for the warning icon
 *  - Copy button auto-disables for 5 seconds after use
 *  - Uses `close-icon`-style "✕" for the close button (icon doesn't exist)
 */
import { memo, useCallback, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { AttentionIcon } from '@/shared/ui/icons/attention-icon';
import { t } from '@/shared/ui/lib/t';

export interface GeneratedTokenDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** The generated token value (shown in plaintext). */
  token: string;
  /** The token's name (shown above the value). */
  name: string;
  /** Called when the user dismisses the dialog (close / copy). */
  onClose: () => void;
}

export const GeneratedTokenDialog = memo(function GeneratedTokenDialog({
  open,
  token,
  name,
  onClose,
}: GeneratedTokenDialogProps) {
  const theme = useTheme();
  const [copyLabel, setCopyLabel] = useState(
    () => t('entities.token.generated.copy', 'Copy'),
  );
  const styles = getStyles();

  const isCopyDisabled = copyLabel === t('entities.token.generated.copied', 'Copied!');

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(token);
    setCopyLabel(t('entities.token.generated.copied', 'Copied!'));
    // Re-enable after 5 seconds
    setTimeout(() => {
      setCopyLabel(t('entities.token.generated.copy', 'Copy'));
    }, 5000);
  }, [token]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !isCopyDisabled) {
        e.preventDefault();
        handleCopy();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [isCopyDisabled, handleCopy, onClose],
  );

  return (
    <Dialog
      open={open}
      onKeyDown={handleKeyDown}
      onClose={onClose}
      sx={styles.dialog}
    >
      <DialogContent sx={styles.dialogContent}>
        <Box sx={styles.header}>
          <Typography
            variant="headingSmall"
            sx={styles.title}
          >
            {t('entities.token.generated.title', 'New token generated!')}
          </Typography>
          <IconButton
            size="small"
            onClick={onClose}
            sx={styles.closeButton}
          >
            <span style={{ fontSize: theme.typography.headingMedium.fontSize }}>{t('common.close', '✕')}</span>
          </IconButton>
        </Box>

        <Box sx={styles.warningContainer}>
          <Box sx={styles.warningIcon}>
            <AttentionIcon />
          </Box>
          <Typography
            variant="bodySmall"
            color="text.attention"
          >
            {t(
              'entities.token.generated.warning',
              'This token will only be shown once, so make sure to copy and save it.',
            )}
          </Typography>
        </Box>

        <Box sx={styles.tokenBox}>
          <Typography
            variant="bodyMedium"
            sx={styles.tokenName}
          >
            {name}
          </Typography>
          <Box sx={styles.tokenScrollBox}>
            <Typography
              variant="bodyMedium"
              sx={styles.tokenValue}
            >
              {token}
            </Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={styles.dialogActions}>
        <Button
          variant="elitea"
          color="primary"
          onClick={handleCopy}
          disabled={isCopyDisabled}
        >
          {copyLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
});

const getStyles = (): {
  dialog: SxProps<Theme>;
  dialogContent: SxProps<Theme>;
  dialogActions: SxProps<Theme>;
  header: SxProps<Theme>;
  title: SxProps<Theme>;
  closeButton: SxProps<Theme>;
  warningContainer: SxProps<Theme>;
  warningIcon: SxProps<Theme>;
  tokenBox: SxProps<Theme>;
  tokenName: SxProps<Theme>;
  tokenScrollBox: SxProps<Theme>;
  tokenValue: SxProps<Theme>;
} => ({
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    padding: '1rem 1.5rem',
    alignItems: 'center',
    gap: '1rem',
  },
  dialogContent: ({ palette }) => ({
    width: '31.25rem',
    borderTopLeftRadius: 'var(--el-shape-radiusSm, 4px)',
    borderTopRightRadius: 'var(--el-shape-radiusSm, 4px)',
    background: palette.background.secondary,
    padding: '1rem 1.5rem 0',
    overflowX: 'hidden',
  }),
  dialogActions: ({ palette }) => ({
    width: '31.25rem',
    borderBottomLeftRadius: 'var(--el-shape-radiusSm, 4px)',
    borderBottomRightRadius: 'var(--el-shape-radiusSm, 4px)',
    background: palette.background.secondary,
    padding: '0 1.5rem 1rem',
    justifyContent: 'flex-end',
  }),
  header: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: ({ palette, typography }) => ({
    fontFamily: 'Montserrat',
    fontSize: typography.headingSmall.fontSize,
    fontWeight: 600,
    lineHeight: '1.5rem',
    color: palette.text.secondary,
  }),
  closeButton: ({ palette }) => ({
    cursor: 'pointer',
    fill: palette.icon.fill.default,
  }),
  warningContainer: ({ palette }) => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    borderColor: palette.border.attention,
    backgroundColor: palette.background.attention,
    borderRadius: 'var(--el-shape-radiusSm, 4px)',
  }),
  warningIcon: ({ palette }) => ({
    width: '1rem',
    height: '1rem',
    fill: palette.icon.fill.attention,
    flexShrink: 0,
  }),
  tokenBox: ({ palette }) => ({
    marginTop: '1rem',
    padding: '0.5rem 0.75rem',
    borderBottom: `0.0625rem solid ${palette.border.lines}`,
  }),
  tokenName: {
    marginBottom: '0.25rem',
  },
  tokenScrollBox: {
    maxHeight: '3rem',
    overflowY: 'scroll',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' },
  },
  tokenValue: {
    wordBreak: 'break-word',
  },
});
