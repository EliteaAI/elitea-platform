/**
 * Port of
 * apps/elitea-ui/src/[fsd]/features/mcp/lib/hooks/useMcpTokenChange.hooks.js
 * (unit A5). Monitors the `elitea_mcp_token_change` `window` event
 * `storage.ts` dispatches, so the whole UI re-renders login/logout state
 * immediately, even when the change originated in a different component
 * tree (e.g. a modal's `onAuthorize` vs. a status badge elsewhere on the
 * same page).
 */
import { useCallback, useEffect, useState } from 'react';

import { MCP_TOKEN_CHANGE_EVENT } from '../lib/constants';
import { getAccessToken, getStorageKey } from '../lib/storage';

export interface McpTokenChangeOptions {
  serverUrl?: string | undefined;
  toolkitType?: string | undefined;
}

export interface McpTokenChangeResult {
  isLoggedIn: boolean;
  refreshLoginStatus: () => void;
}

interface TokenChangeEventDetail {
  serverUrl: string;
  type: 'login' | 'logout';
}

/** Accepts either a bare server-URL string (legacy call shape) or an options object. */
export function useMcpTokenChange(serverUrlOrOptions: string | McpTokenChangeOptions | undefined): McpTokenChangeResult {
  const options = typeof serverUrlOrOptions === 'string' ? { serverUrl: serverUrlOrOptions } : (serverUrlOrOptions ?? {});
  const { serverUrl, toolkitType } = options;
  const storageKey = getStorageKey({ serverUrl, toolkitType });

  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => (storageKey ? getAccessToken(serverUrl, toolkitType) !== null : false));

  const refreshLoginStatus = useCallback(() => {
    if (storageKey) setIsLoggedIn(getAccessToken(serverUrl, toolkitType) !== null);
  }, [storageKey, serverUrl, toolkitType]);

  useEffect(() => {
    refreshLoginStatus();
  }, [refreshLoginStatus]);

  useEffect(() => {
    if (!storageKey) return;

    function handleTokenChange(event: Event): void {
      const detail = (event as CustomEvent<TokenChangeEventDetail>).detail;
      if (detail?.serverUrl === storageKey) refreshLoginStatus();
    }

    window.addEventListener(MCP_TOKEN_CHANGE_EVENT, handleTokenChange);
    return () => window.removeEventListener(MCP_TOKEN_CHANGE_EVENT, handleTokenChange);
  }, [storageKey, refreshLoginStatus]);

  return { isLoggedIn, refreshLoginStatus };
}
