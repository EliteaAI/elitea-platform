/**
 * Port of apps/elitea-ui/src/[fsd]/features/mcp/ui/McpAuthStatus.jsx (unit
 * A5, manifest COPY-140). Renders "Connected!"/"Not Connected" plus a
 * Login/Logout action inline in a toolkit-settings form.
 *
 * DEVIATION FROM BASELINE: `values` is a required prop instead of pulled
 * from `useFormikContext()` — this app uses react-hook-form (§2.3), not
 * formik, and `shared/ui`/`features/` components should not assume a
 * specific form-library context is mounted above them; the caller (a
 * toolkit-settings form, out of this unit's scope) passes its current
 * field values down like any other controlled-component prop.
 */
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Snackbar from '@mui/material/Snackbar';
import type { Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { OnlineIcon } from '@/shared/ui/icons/online-icon';

import type { McpLoginAuthConfig } from '../model/useMcpLogin';
import { useMcpLogin } from '../model/useMcpLogin';
import { isPrebuildMcpType, logout } from '../lib/storage';

import { McpAuthModal } from './McpAuthModal';
import { McpLogoutModal } from './McpLogoutModal';

interface McpAuthStatusBadgeValues {
  id?: string | undefined;
  type?: string | undefined;
  settings?: { url?: string | undefined; client_id?: string | undefined; client_secret?: string | undefined; scopes?: string | readonly string[] | undefined } | undefined;
}

export interface McpAuthStatusBadgeProps {
  values: McpAuthStatusBadgeValues;
  projectId?: string | number | undefined;
  authConfig?: McpLoginAuthConfig | undefined;
}

function statusContentSx(hasLoggedInToMcp: boolean) {
  return (theme: Theme) => ({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: hasLoggedInToMcp ? theme.vars.palette.icon.fill.success : theme.vars.palette.icon.fill.attention,
  });
}

function loginStatusTextSx(hasLoggedInToMcp: boolean) {
  return (theme: Theme) => ({
    color: hasLoggedInToMcp ? theme.vars.palette.text.mcp.loginSuccess : theme.vars.palette.text.mcp.logout,
  });
}

function loginStatusContainerSx(hasLoggedInToMcp: boolean) {
  return (theme: Theme) => ({
    marginTop: theme.spacing(2),
    height: '2.75rem',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
    padding: theme.spacing(1, 1, 1, 2),
    borderRadius: theme.vars.shape.radiusPill ?? 9999,
    backgroundColor: hasLoggedInToMcp ? theme.vars.palette.background.mcp.loginSuccess : theme.vars.palette.background.mcp.logout,
    border: `0.0625rem solid ${hasLoggedInToMcp ? theme.vars.palette.border.mcp.loginSuccess : theme.vars.palette.border.mcp.logout}`,
    justifyContent: 'space-between',
  });
}

/** `authConfig`'s storage key, falling back to its server URL, falling back to the toolkit's own settings URL — split out of the component body (§3.5 complexity budget). */
function resolveLogoutTargetUrl(authConfig: McpLoginAuthConfig | undefined, settingsUrl: string | undefined): string | undefined {
  return authConfig?.tokenStorageKey ?? authConfig?.serverUrl ?? settingsUrl;
}

function resolveCanLogin(authConfig: McpLoginAuthConfig | undefined, isPrebuildMcp: boolean, settingsUrl: string | undefined): boolean {
  return Boolean(authConfig || isPrebuildMcp || settingsUrl);
}

function resolveAuthStatusButtonLabel(hasLoggedInToMcp: boolean, isRunning: boolean): string {
  if (hasLoggedInToMcp) return t('mcps.authStatus.logout', 'Logout');
  if (isRunning) return t('mcps.authStatus.loggingIn', 'Logging in...');
  return t('mcps.authStatus.login', 'Login');
}

/**
 * Baseline: `RouteDefinitions.CreateMCP` (`/mcps/create`) via
 * `useIsFrom(path)` — react-router-dom's `useLocation().pathname.startsWith(path)`.
 * `/mcps/create` is this app's own verified route prefix (unit R1:
 * `src/routes/_shell/mcps/create.$mcpType.tsx` → `/mcps/create/:mcpType`),
 * already used for this exact "hide the connection-status widget while on
 * the create-MCP page" rule by
 * `features/interactive-tours/lib/constants/mcpTour.constants.ts`'s
 * `CREATE_MCP_PATH`/`shouldSkipConnectionStatusStep` — duplicated here
 * (rather than imported) because that's a sibling feature slice (FSD
 * layering forbids `features/` importing from another `features/`) and the
 * constant is a one-line, unlikely-to-drift route literal.
 *
 * Read via a plain `window.location` check (not `@tanstack/react-router`'s
 * `useRouterState`) because this component has no guaranteed
 * `RouterProvider` in scope — it's a `features/` leaf with no `pages/`/
 * `widgets/` caller yet (nothing under `src/pages`/`src/widgets` renders
 * `McpAuthStatusBadge` as of this fix) and its own test harness
 * (`../__tests__/renderWithMcpProviders.tsx`) wraps only theme/socket
 * providers, not a router. A route-only React context is out of this
 * unit's file scope to add. Pure/exported so it's independently testable
 * against a pathname string without touching `window`.
 */
export const CREATE_MCP_PATH = '/mcps/create';

export function isOnCreateMcpRoute(pathname: string): boolean {
  return pathname.startsWith(CREATE_MCP_PATH);
}

/**
 * `authConfig` implies an external always-capable-of-login flow (out of
 * this unit's scope today, and the parent — e.g. `SharepointOAuthStatus` —
 * already gates rendering on OAuth mode) — always render for it,
 * regardless of route/id. Otherwise: an already-connected toolkit always
 * renders (so the user can see/undo the connection from anywhere), and a
 * not-yet-connected one renders only once it's saved (`id` present) AND
 * the user isn't still on the create-MCP page — matches the baseline's
 * `shouldRender = authConfig ? true : hasLoggedInToMcp || (!isFromCreateMcp && id)`.
 */
function resolveShouldRenderAuthStatus(authConfig: McpLoginAuthConfig | undefined, hasLoggedInToMcp: boolean, id: string | undefined, isFromCreateMcp: boolean): boolean {
  return Boolean(authConfig) || hasLoggedInToMcp || (!isFromCreateMcp && Boolean(id));
}

export function McpAuthStatusBadge({ values, projectId, authConfig }: McpAuthStatusBadgeProps): ReactNode {
  const { id, type: toolkitType } = values;
  const isPrebuildMcp = isPrebuildMcpType(toolkitType);
  const settingsUrl = values.settings?.url;
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showLogoutSuccess, setShowLogoutSuccess] = useState(false);
  // Plain `window.location` read, not a subscribed/reactive hook — see
  // `isOnCreateMcpRoute`'s own doc comment for why.
  const isFromCreateMcp = typeof window !== 'undefined' && isOnCreateMcpRoute(window.location.pathname);

  const { isLoggedIn: hasLoggedInToMcp, isRunning, onLogin, modalProps } = useMcpLogin({ values, authConfig, projectId });

  const onConfirmLogout = useCallback(() => {
    const logoutKey = authConfig?.tokenStorageKey ?? authConfig?.serverUrl;
    if (logoutKey) {
      logout(logoutKey);
    } else if (isPrebuildMcp) {
      logout(undefined, toolkitType);
    } else if (settingsUrl) {
      logout(settingsUrl);
    }
    setShowLogoutModal(false);
    setShowLogoutSuccess(true);
  }, [authConfig, isPrebuildMcp, toolkitType, settingsUrl]);

  const onLogout = useCallback(() => setShowLogoutModal(true), []);
  const onCloseLogout = useCallback(() => setShowLogoutModal(false), []);
  const onCloseLogoutSuccess = useCallback(() => setShowLogoutSuccess(false), []);

  const isButtonDisabled = !resolveCanLogin(authConfig, isPrebuildMcp, settingsUrl) || isRunning;
  const buttonLabel = resolveAuthStatusButtonLabel(hasLoggedInToMcp, isRunning);

  if (!resolveShouldRenderAuthStatus(authConfig, hasLoggedInToMcp, id, isFromCreateMcp)) return null;

  return (
    <>
      <Box
        sx={loginStatusContainerSx(hasLoggedInToMcp)}
        data-testid="mcp-auth-status"
      >
        <Box sx={statusContentSx(hasLoggedInToMcp)}>
          <OnlineIcon
            width={14}
            height={14}
          />
          <Typography
            variant="bodySmall"
            sx={loginStatusTextSx(hasLoggedInToMcp)}
          >
            {hasLoggedInToMcp ? t('mcps.authStatus.connected', 'Connected!') : t('mcps.authStatus.notConnected', 'Not Connected')}
          </Typography>
        </Box>
        <BaseBtn
          onClick={hasLoggedInToMcp ? onLogout : (event) => onLogin(event)}
          disabled={isButtonDisabled}
          variant="secondary"
        >
          {buttonLabel}
        </BaseBtn>
      </Box>
      {modalProps.open && <McpAuthModal {...modalProps} />}
      <McpLogoutModal
        serverUrl={resolveLogoutTargetUrl(authConfig, settingsUrl)}
        toolkitType={isPrebuildMcp ? toolkitType : undefined}
        open={showLogoutModal}
        onClose={onCloseLogout}
        onConfirm={onConfirmLogout}
      />
      <Snackbar
        open={showLogoutSuccess}
        autoHideDuration={3000}
        onClose={onCloseLogoutSuccess}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={onCloseLogoutSuccess}
          severity="success"
          variant="filled"
        >
          {t('mcps.logout.success', 'You have successfully logged out!')}
        </Alert>
      </Snackbar>
    </>
  );
}
