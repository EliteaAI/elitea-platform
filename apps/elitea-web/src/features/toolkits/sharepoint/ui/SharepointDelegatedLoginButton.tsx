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

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/sharepoint/ui/
 * SharepointDelegatedLoginButton.jsx` (Wave-2 unit A4e). A compact status
 * pill for the delegated (OAuth) SharePoint case — a "Log in" text button
 * next to an online/offline dot, used e.g. inline in a toolkit-list card.
 *
 * DISCLOSED REDESIGN (`no-sideways-features`, see `../lib/hooks/
 * useSharepointAuthModal.hooks.ts`'s own doc comment for the full
 * rationale): the baseline renders `<McpAuthModal {...configOAuth.
 * getModalProps()} />` directly (`features/mcp`). This component cannot —
 * `features/toolkits` may not import `features/mcps`.
 *
 * **THE MODAL IS THE CALLER'S, NOT A SLOT HERE (changed).** This component
 * used to take a `renderAuthModal`/`authModalSlotProps` PAIR that nothing in
 * `src/` ever supplied — dead wiring that read as an available extension
 * point. It was also redundant: the caller already owns the
 * `useSharepointAuthModal` INSTANCE it passes in as `onConfigAuthRequired`,
 * so it holds that hook's `modalProps` too and can render the modal beside
 * this button with no help from here. Both props are therefore removed
 * rather than left dangling. (`SharepointOAuthStatus.tsx`, the settings-form
 * sibling, keeps its slots for the opposite reason: it owns its OWN hook
 * instance internally, so the renderers genuinely have to reach it — and as
 * of this change a real caller supplies them.)
 *
 * NOTE ON REACHABILITY: this component's intended mount point is
 * `features/agents/ui/ToolCard.tsx`'s `delegatedAuth.sharepointLoginSlot`,
 * which is itself inside a subtree with no production mount — `ToolCard` is
 * rendered only through `ApplicationTools`' `renderToolCard`, and
 * `ApplicationTools` has no JSX call site anywhere in `src/` yet. Wiring
 * THIS button end-to-end is therefore blocked on that whole agent-editor
 * composition landing, not on anything in this file.
 */
export interface SharepointDelegatedLoginButtonProps {
  readonly projectId: string | undefined;
  readonly spConfig: SharepointResolvedConfig | null;
  readonly toolName?: string;
  readonly oauthTokenKey: string;
  /** `useSharepointAuthModal`'s `handleConfigAuthRequired`, from the caller's own hook instance — that same caller renders the modal itself (see module doc comment). */
  readonly onConfigAuthRequired?: (errorData: unknown, serverUrlOverride?: string, tokenStorageKeyOverride?: string) => void;
}

export function SharepointDelegatedLoginButton({
  projectId,
  spConfig,
  toolName,
  oauthTokenKey,
  onConfigAuthRequired,
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
  );
}

const loginTextSx: SxProps<Theme> = {
  color: 'primary.main',
  '&:hover': { color: 'primary.dark' },
};
