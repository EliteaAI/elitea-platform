import type { ReactNode } from 'react';
import { useContext } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';

import { SocketClientContext } from '@/shared/api/socket/client';
import { t } from '@/shared/i18n';

/**
 * SHELL-012 — the sidebar's socket connectivity indicator. Old app:
 * `SidebarBody.jsx`'s `socketIconContainer` dot +
 * `useSocketIcon.hooks.jsx` (`isSocketIconVisible: true` unconditionally,
 * `socketStatus` from Redux `state.settings.socketConnected`, itself
 * written by `[fsd]/app/root.jsx:35-71`'s socket lifecycle listeners).
 *
 * The new app's socket lifecycle lives in `shared/api/socket/client.ts`'s
 * `createSocketClient` (unit S5). As of this unit, no landed `app/` file
 * mounts a `SocketClientContext.Provider` (that file's own doc comment
 * names the gap: "app/ owns creation" of the client, and R2's
 * `AppProviders.tsx` does not construct or provide one yet) — reads
 * `useContext` directly (not the throwing `useSocketClient()` helper) and
 * renders nothing when no provider is mounted, so this widget degrades
 * gracefully today and lights up automatically the moment that provider
 * lands, with no further change needed here.
 */
export function SidebarConnectionDot(): ReactNode {
  const client = useContext(SocketClientContext);
  if (client === null) return null;

  return <ConnectedDot client={client} />;
}

function ConnectedDot({ client }: { client: NonNullable<React.ContextType<typeof SocketClientContext>> }): ReactNode {
  const status = client.useConnectionState();
  const connected = status === 'connected';

  return (
    <Tooltip
      title={
        connected
          ? t('widgets.sidebar.connection.connected', 'Connected')
          : t('widgets.sidebar.connection.disconnected', 'Disconnected')
      }
      placement="right"
    >
      <Box
        data-testid="sidebar-connection-dot"
        sx={(theme: Theme) => ({
          width: '0.5rem',
          height: '0.5rem',
          borderRadius: theme.vars.shape.radiusPill,
          backgroundColor: connected ? theme.vars.palette.icon.fill.success : theme.vars.palette.icon.fill.error,
          position: 'absolute',
          top: 0,
          right: 0,
        })}
      />
    </Tooltip>
  );
}
