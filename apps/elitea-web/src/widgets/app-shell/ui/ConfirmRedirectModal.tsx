import type { ReactNode } from 'react';
import { useCallback, useEffect } from 'react';

import Typography from '@mui/material/Typography';

import { BaseModal } from '@/shared/ui/BaseModal';
import { t } from '@/shared/i18n';

export interface ConfirmRedirectModalProps {
  open: boolean;
  toolkitName?: string | undefined;
  toolkitDescription?: string | undefined;
  redirectUrl: string;
  onClose: () => void;
}

/**
 * Ported from `components/ConfirmRedirectModal.jsx` — confirms opening a
 * redirect-type toolkit's URL in a new tab. On `shared/ui`'s `BaseModal`
 * (old app used a bespoke `StyledDialog`, not present among S1's 67
 * `shared/ui` components).
 */
export function ConfirmRedirectModal({
  open,
  toolkitName,
  toolkitDescription,
  redirectUrl,
  onClose,
}: ConfirmRedirectModalProps): ReactNode {
  const handleOpenInNewTab = useCallback(() => {
    window.open(redirectUrl, '_blank', 'noopener,noreferrer');
    onClose();
  }, [redirectUrl, onClose]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleOpenInNewTab();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, handleOpenInNewTab, onClose]);

  return (
    <BaseModal
      variant="simple"
      open={open}
      title={t('widgets.appShell.confirmRedirect.title', 'Open Application')}
      onClose={onClose}
      onConfirm={handleOpenInNewTab}
      actions={{
        cancelText: t('widgets.appShell.confirmRedirect.cancel', 'Cancel'),
        confirmText: t('widgets.appShell.confirmRedirect.open', 'Open in New Tab'),
      }}
      content={
        <>
          <Typography
            variant="bodyMedium"
            sx={{ mb: 1 }}
          >
            {toolkitName || t('widgets.appShell.confirmRedirect.thisApplication', 'This application')}{' '}
            {t('widgets.appShell.confirmRedirect.willOpen', 'will open in a new browser tab.')}
          </Typography>
          {toolkitDescription && (
            <Typography
              variant="bodySmall"
              color="text.secondary"
            >
              {toolkitDescription}
            </Typography>
          )}
        </>
      }
    />
  );
}
