/**
 * The platform-wide notification banner.
 *
 * Ported from EliteaUI's `features/maintenance/ui/MaintenanceBanner.jsx`, whose
 * config came from a build-time environment variable. Here it comes from
 * `usePlatformAnnouncements()` — see that hook for why that difference is the
 * whole feature and not an implementation detail.
 *
 * ## Dismissal is per MESSAGE, not per banner
 *
 * Closing the banner stores the message that was closed, and the banner returns
 * when the operator writes a DIFFERENT one. Storing a boolean instead would mean
 * a user who dismissed "scheduled upgrade tonight" never sees "we are
 * investigating an incident", which is precisely the message a banner exists to
 * deliver. This is the legacy component's rule, kept.
 *
 * It goes through `createStorage('local')`, so the key is namespaced and the
 * logout sweep reaches it. The legacy component wrote a raw
 * `maintenance_banner_dismissed` key, which is the class of key `clearNamespace`
 * cannot see.
 *
 * ## The message is markdown with HTML disabled
 *
 * Operator-authored text rendered to every user of the platform is the textbook
 * stored-XSS target, and the admin form that writes it is reachable by anyone
 * holding `runtime.plugins` rather than only by the deployment's owners.
 * `renderHtml={false}` keeps `**bold**` and links working and drops raw HTML;
 * `DefaultMarkdown` sanitises what is left. The legacy component also translated
 * literal `<br>` into a newline, which is not reproduced: it exists only because
 * that renderer honoured raw HTML, and reintroducing the tag to support the
 * workaround for its absence would be circular.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';

import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import Alert from '@mui/material/Alert';

import { t } from '@/shared/i18n';
import { createStorage } from '@/shared/lib/storage';
import { DefaultMarkdown } from '@/shared/ui/DefaultMarkdown';
import type { PlatformBanner as PlatformBannerConfig } from '@/shared/lib/hooks/usePlatformAnnouncements';

/** Namespaced (`el.`), so §5.4's logout sweep clears it. */
const DISMISSED_MESSAGE_KEY = 'maintenanceBanner.dismissedMessage';

export interface PlatformBannerProps {
  readonly banner: PlatformBannerConfig;
}

export function PlatformBanner({ banner }: PlatformBannerProps): ReactNode {
  const storage = createStorage('local');
  // Read ONCE, into initial state. Reading on every render would make the
  // banner re-appear or vanish depending on unrelated re-renders after a
  // dismissal in another tab, and this is not state worth synchronising.
  const [dismissedMessage, setDismissedMessage] = useState(() =>
    storage.get(DISMISSED_MESSAGE_KEY),
  );

  if (!banner.enabled || banner.message === '' || dismissedMessage === banner.message) {
    return null;
  }

  const Icon = banner.icon === 'warning' ? WarningAmberIcon : InfoOutlinedIcon;

  return (
    <Alert
      // MUI's `warning`/`info` severities carry the same two registers the
      // server's enum does, so the tone maps straight across rather than
      // through a local colour table.
      severity={banner.style === 'warning' ? 'warning' : 'info'}
      icon={<Icon fontSize="small" />}
      variant="outlined"
      data-testid="platform-banner"
      onClose={
        banner.dismissible
          ? () => {
              storage.set(DISMISSED_MESSAGE_KEY, banner.message);
              setDismissedMessage(banner.message);
            }
          : undefined
      }
      // `output` (implicit role `status`, announced politely) rather than
      // MUI's default `role="alert"`: an operator notice is not an
      // interruption, and `alert` would move a screen-reader user's focus on
      // every page load for as long as the banner is up.
      component="output"
      aria-live="polite"
      slotProps={{ closeButton: { 'aria-label': t('widgets.appShell.banner.dismiss', 'Dismiss') } }}
      sx={{ alignItems: 'center' }}
    >
      <DefaultMarkdown markdown={banner.message} renderHtml={false} inline />
    </Alert>
  );
}
