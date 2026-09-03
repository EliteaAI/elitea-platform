/**
 * The one confirmation the package controls ask (ADR-0024 WP9): restoring a
 * kept package always, and opening the import while the draft is dirty —
 * either replaces the whole database layer, so a draft on the page would be
 * written back stale by the next Save.
 */
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

import { t } from '@/shared/i18n';

import { shortDigest } from './brandingPackage';
import type { BrandingPackagePendingAction } from './useBrandingPackage';

export interface BrandingPackageConfirmDialogProps {
  readonly pending: BrandingPackagePendingAction | undefined;
  readonly isDirty: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function BrandingPackageConfirmDialog({ pending, isDirty, onCancel, onConfirm }: BrandingPackageConfirmDialogProps) {
  const version = pending?.kind === 'restore' ? pending.version : undefined;
  const isRestore = version !== undefined;
  const title = isRestore
    ? t('pages.admin.branding.package.confirm.restore.title', 'Restore this branding package?')
    : t('pages.admin.branding.package.confirm.import.title', 'Discard unsaved changes and import?');
  const body = isRestore
    ? `${t(
        'pages.admin.branding.package.confirm.restore.body',
        'Every branding key is set from the kept package and users see it on their next page load.',
      )} (${[version.product ?? '', shortDigest(version.digest)].filter((part) => part !== '').join(' · ')})`
    : t(
        'pages.admin.branding.package.confirm.import.body',
        'An applied package sets every branding key, so the changes you have not saved on this page would be lost.',
      );
  const dirtyNote =
    isRestore && isDirty
      ? t(
          'pages.admin.branding.package.confirm.dirty',
          'The changes you have not saved on this page are discarded.',
        )
      : undefined;
  return (
    <Dialog open={pending !== undefined} onClose={onCancel} aria-labelledby="branding-package-confirm-title" data-testid="branding-package-confirm">
      <DialogTitle id="branding-package-confirm-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{body}</DialogContentText>
        {dirtyNote === undefined ? null : <DialogContentText>{dirtyNote}</DialogContentText>}
      </DialogContent>
      <DialogActions>
        <Button variant="secondary" size="small" onClick={onCancel} data-testid="branding-package-confirm-cancel">
          {t('pages.admin.branding.package.confirm.cancel', 'Cancel')}
        </Button>
        <Button variant="alarm" size="small" onClick={onConfirm} data-testid="branding-package-confirm-ok">
          {isRestore
            ? t('pages.admin.branding.package.confirm.restore.ok', 'Restore')
            : t('pages.admin.branding.package.confirm.import.ok', 'Discard and import')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
