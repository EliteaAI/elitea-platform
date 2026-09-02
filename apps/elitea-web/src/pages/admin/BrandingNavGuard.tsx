/**
 * The Branding page's unsaved-changes guard (ADR-0024 WP4).
 *
 * The same shape as `widgets/app-shell/ui/NavBlockerDialog.tsx`, which the
 * admin SPA does not mount (see `brandingDirty.store.ts` for why it carries
 * its own): TanStack Router's `useBlocker` with `withResolver`, a predicate
 * that reads the LIVE store rather than a rendered value (#133 — the page
 * lowers the flag and may navigate in the same event as a save), and
 * `enableBeforeUnload` gated the same way so the browser's own prompt fires
 * only with real unsaved work. Same-pathname navigations pass.
 */
import { useBlocker } from '@tanstack/react-router';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';

import { t } from '@/shared/i18n';

import { useBrandingDirtyStore } from './brandingDirty.store';

export function BrandingNavGuard() {
  const { status, proceed, reset } = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      useBrandingDirtyStore.getState().dirty && current.pathname !== next.pathname,
    enableBeforeUnload: () => useBrandingDirtyStore.getState().dirty,
    withResolver: true,
  });

  const stay = reset ?? (() => {});
  const leave = (): void => {
    useBrandingDirtyStore.getState().setDirty(false);
    proceed?.();
  };

  return (
    <Dialog open={status === 'blocked'} onClose={stay} data-testid="branding-nav-guard">
      <DialogTitle>{t('pages.admin.branding.guard.title', 'Unsaved branding changes')}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {t(
            'pages.admin.branding.guard.body',
            'You have unsaved changes on the Branding page. Leave and discard them?',
          )}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button variant="secondary" size="small" onClick={stay} data-testid="branding-nav-guard-stay">
          {t('pages.admin.branding.guard.stay', 'Stay')}
        </Button>
        <Button variant="alarm" size="small" onClick={leave} data-testid="branding-nav-guard-leave">
          {t('pages.admin.branding.guard.leave', 'Leave')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
