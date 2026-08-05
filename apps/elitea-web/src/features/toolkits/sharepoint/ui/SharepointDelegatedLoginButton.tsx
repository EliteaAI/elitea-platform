import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { OfflineIcon } from '@/shared/ui/icons/offline-icon';
import { OnlineIcon } from '@/shared/ui/icons/online-icon';

import type { SharepointResolvedConfig } from '../lib/hooks/useResolvedSharepointConfig.hooks';
import { useSharepointCheckConnection } from '../lib/hooks/useSharepointCheckConnection.hooks';
import { useSharepointTokenStatus } from '../lib/hooks/useSharepointTokenStatus.hooks';
import type { SharepointAuthModalSlotProps } from '../lib/hooks/useSharepointAuthModal.hooks';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/sharepoint/ui/
 * SharepointDelegatedLoginButton.jsx` (Wave-2 unit A4e). A compact status
 * pill for the delegated (OAuth) SharePoint case — a "Log in" text button
 * next to an online/offline dot, used e.g. inline in a toolkit-list card.
 *
 * DISCLOSED REDESIGN (`no-sideways-features`, see `../lib/hooks/
 * useSharepointAuthModal.hooks.ts`'s own doc comment for the full
 * rationale): the baseline renders `<McpAuthModal {...configOAuth.
 * getModalProps()} />` directly (`features/mcp`). This component instead
 * takes `renderAuthModal` — a render-prop slot a `widgets/`/`pages/`-layer
 * caller (which may legally import both `features/toolkits` and
 * `features/mcps`) fills with a real `<McpAuthModal>`, spreading the
 * supplied `SharepointAuthModalSlotProps` onto it. Omitting the prop is a
 * legitimate, fully-functional choice too — the status dot and `runCheck`
 * flow still work; only the "open the OAuth modal on 401" step is a no-op
 * (via `onLogin`'s AND-guarded call), same graceful-degradation shape
 * `entities/application-form`'s slot components already use for an omitted
 * panel.
 */
export interface SharepointDelegatedLoginButtonProps {
  readonly projectId: string | undefined;
  readonly spConfig: SharepointResolvedConfig | null;
  readonly toolName?: string;
  readonly oauthTokenKey: string;
  /** `useSharepointAuthModal`'s `handleConfigAuthRequired`, from the caller's own hook instance. */
  readonly onConfigAuthRequired?: (errorData: unknown, serverUrlOverride?: string, tokenStorageKeyOverride?: string) => void;
  /** Renders a real `McpAuthModal` (from `features/mcps`) spread with these slot props — see module doc comment. */
  readonly renderAuthModal?: (slotProps: SharepointAuthModalSlotProps) => ReactNode;
  readonly authModalSlotProps?: SharepointAuthModalSlotProps;
}

export function SharepointDelegatedLoginButton({
  projectId,
  spConfig,
  toolName,
  oauthTokenKey,
  onConfigAuthRequired,
  renderAuthModal,
  authModalSlotProps,
}: SharepointDelegatedLoginButtonProps): ReactNode {
  const { isLoggedIn: isOAuthLoggedIn } = useSharepointTokenStatus(oauthTokenKey);
  const { runCheck, isRunning } = useSharepointCheckConnection({ projectId, spConfig });

  const onLogin = useCallback(() => {
    void runCheck(onConfigAuthRequired, oauthTokenKey);
  }, [runCheck, onConfigAuthRequired, oauthTokenKey]);

  // Baseline (`SharepointDelegatedLoginButton.jsx:37-39`): `toolName || 'SharePoint'`,
  // NOT `??` — an empty/whitespace-collapsed-to-empty `toolName` must also fall
  // back to the literal 'SharePoint', not render a blank tooltip.
  const resolvedToolName = toolName || 'SharePoint';
  const statusTip = isOAuthLoggedIn
    ? t('features.toolkits.sharepointDelegatedLoginButton.connected', '{{toolName}} is connected', { toolName: resolvedToolName })
    : t('features.toolkits.sharepointDelegatedLoginButton.notConnected', '{{toolName}} is not connected. Log in to use.', {
        toolName: resolvedToolName,
      });

  const statusIconBoxSx = useMemo<SxProps<Theme>>(
    () => (theme: Theme) => ({
      display: 'flex',
      alignItems: 'center',
      marginLeft: theme.spacing(0.25),
      color: isOAuthLoggedIn ? theme.vars.palette.icon.fill.default : theme.vars.palette.icon.fill.attention,
      gap: theme.spacing(0.5),
    }),
    [isOAuthLoggedIn],
  );

  return (
    <>
      <Tooltip
        title={statusTip}
        placement="top"
      >
        <Box sx={statusIconBoxSx}>
          {!isOAuthLoggedIn && (
            <BaseBtn
              variant="elitea"
              color="tertiary"
              size="small"
              onClick={onLogin}
              disabled={isRunning}
              sx={loginTextSx}
            >
              {t('features.toolkits.sharepointDelegatedLoginButton.logIn', 'Log in')}
            </BaseBtn>
          )}
          {isOAuthLoggedIn ? (
            <OnlineIcon
              width={16}
              height={16}
            />
          ) : (
            <OfflineIcon
              width={16}
              height={16}
            />
          )}
        </Box>
      </Tooltip>
      {renderAuthModal && authModalSlotProps && renderAuthModal(authModalSlotProps)}
    </>
  );
}

const loginTextSx: SxProps<Theme> = {
  color: 'primary.main',
  '&:hover': { color: 'primary.dark' },
};
