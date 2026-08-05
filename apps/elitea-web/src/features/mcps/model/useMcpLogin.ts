/**
 * Port of
 * apps/elitea-ui/src/[fsd]/features/mcp/lib/hooks/useMcpLogin.hooks.js
 * (unit A5) — combines `useMcpTokenChange` (login-status display) with
 * `useMcpAuthCheck` (the connection test that surfaces
 * `mcp_authorization_required`) into the single hook `McpLogInButton`/
 * `McpLogInLink` drive. `authConfig` lets a non-MCP OAuth caller (e.g. the
 * `openapi`/`sharepoint` features in the baseline, out of this unit's
 * scope) inject its own login/serverUrl/running-state — accepted here for
 * shape-compatibility even though this unit has no such caller yet.
 */
import { useCallback, useMemo } from 'react';

import { isPrebuildMcpType, setConnectionVerified } from '../lib/storage';

import type { McpAuthModalRenderProps, McpAuthModalValues } from './useMcpAuthModal';
import { useMcpAuthModal } from './useMcpAuthModal';
import type { UseMcpAuthCheckValues } from './useMcpAuthCheck';
import { useMcpAuthCheck } from './useMcpAuthCheck';
import { useMcpTokenChange } from './useMcpTokenChange';

export interface McpLoginAuthConfig {
  /** Delegates the login action to an injected handler (e.g. an HTTP check_connection flow) instead of the socket-based `runAuthCheck`. Receives `handleMcpAuthRequired` so it can still open the OAuth modal on a 401. */
  onLogin?: ((handleMcpAuthRequired: (message: unknown) => void) => void) | undefined;
  serverUrl?: string | undefined;
  tokenStorageKey?: string | undefined;
  isRunning?: boolean | undefined;
  tokenOptions?: { serverUrl?: string | undefined; toolkitType?: string | undefined } | undefined;
}

export interface UseMcpLoginOptions {
  values?: (McpAuthModalValues & UseMcpAuthCheckValues) | undefined;
  onSuccess?: (() => void) | undefined;
  authConfig?: McpLoginAuthConfig | undefined;
  projectId?: string | number | undefined;
}

export interface UseMcpLoginResult {
  isLoggedIn: boolean;
  isRunning: boolean;
  onLogin: (event: { stopPropagation: () => void }) => void;
  stopPropagation: (event: { stopPropagation: () => void }) => void;
  modalProps: McpAuthModalRenderProps;
}

/** `authConfig`'s own token-lookup key, or the toolkit-type/server-url pair derived from `values` — split out of the hook body (§3.5 complexity budget). */
function resolveTokenChangeOptions(
  authConfig: McpLoginAuthConfig | undefined,
  isPrebuildMcp: boolean,
  toolkitType: string | undefined,
  url: string | undefined,
): { toolkitType?: string | undefined } | { serverUrl?: string | undefined } {
  return authConfig?.tokenOptions ?? (isPrebuildMcp ? { toolkitType } : { serverUrl: url });
}

function resolveEffectiveServerUrl(authConfig: McpLoginAuthConfig | undefined, url: string | undefined, runtimeServerUrl: string | undefined): string | undefined {
  return authConfig?.serverUrl ?? url ?? runtimeServerUrl;
}

function buildMcpLoginModalProps(
  baseModalProps: McpAuthModalRenderProps,
  effectiveServerUrl: string | undefined,
  authConfig: McpLoginAuthConfig | undefined,
  isPrebuildMcp: boolean,
  toolkitType: string | undefined,
): McpAuthModalRenderProps {
  return {
    ...baseModalProps,
    serverUrl: effectiveServerUrl,
    tokenStorageKey: authConfig?.tokenStorageKey,
    toolkitType: isPrebuildMcp ? toolkitType : undefined,
  };
}

export function useMcpLogin(options: UseMcpLoginOptions): UseMcpLoginResult {
  const { values, onSuccess, authConfig, projectId } = options;
  const toolkitType = values?.type;
  const url = values?.settings?.url;

  const isPrebuildMcp = useMemo(() => isPrebuildMcpType(toolkitType), [toolkitType]);

  const { isLoggedIn } = useMcpTokenChange(resolveTokenChangeOptions(authConfig, isPrebuildMcp, toolkitType, url));

  const { handleMcpAuthRequired, getModalProps, runtimeServerUrl } = useMcpAuthModal({ onSuccess, values, projectId });

  const handleConnectionSuccess = useCallback(() => {
    // Header-based-auth (no-OAuth) servers: `runAuthCheck`'s success path
    // never stores a token via `startMcpAuthFlow`, so mark it verified
    // here — otherwise `useMcpTokenChange`'s isLoggedIn would never flip.
    if (isPrebuildMcp) {
      setConnectionVerified(undefined, toolkitType);
    } else if (url) {
      setConnectionVerified(url);
    }
    onSuccess?.();
  }, [url, toolkitType, isPrebuildMcp, onSuccess]);

  // `useMcpAuthCheck`'s socket-message shape (`TestConnectionMessage`, a
  // loose `[key: string]: unknown` record) and `useMcpAuthModal`'s
  // `AuthRequiredMessage` (a specifically-shaped `response_metadata`) are
  // two independently-typed views of the SAME runtime object — the
  // `mcp_authorization_required` payload — so bridging them needs an
  // explicit adapter rather than direct structural assignment.
  const handleMcpAuthRequiredFromSocket = useCallback((message: unknown) => handleMcpAuthRequired(message as Parameters<typeof handleMcpAuthRequired>[0]), [handleMcpAuthRequired]);

  const { runAuthCheck, isRunning } = useMcpAuthCheck({
    toolkitId: values?.id,
    values,
    projectId,
    onMcpAuthRequired: handleMcpAuthRequiredFromSocket,
    onSuccess: handleConnectionSuccess,
  });

  const onLogin = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      if (authConfig?.onLogin) {
        authConfig.onLogin(handleMcpAuthRequiredFromSocket);
        return;
      }
      runAuthCheck();
    },
    [authConfig, handleMcpAuthRequiredFromSocket, runAuthCheck],
  );

  const stopPropagation = useCallback((event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  }, []);

  const effectiveServerUrl = resolveEffectiveServerUrl(authConfig, url, runtimeServerUrl);
  const baseModalProps = getModalProps();

  return {
    isLoggedIn,
    isRunning: isRunning || Boolean(authConfig?.isRunning),
    onLogin,
    stopPropagation,
    modalProps: buildMcpLoginModalProps(baseModalProps, effectiveServerUrl, authConfig, isPrebuildMcp, toolkitType),
  };
}
