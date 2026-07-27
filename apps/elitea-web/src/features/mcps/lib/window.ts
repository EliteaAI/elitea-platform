/**
 * OAuth popup window management — port of
 * apps/elitea-ui/src/[fsd]/features/mcp/lib/helpers/mcpAuthWindow.helpers.js
 * (unit A5, spec §9.3).
 *
 * Deviation from baseline: the localStorage cross-tab fallback used the raw
 * `localStorage.getItem/setItem/removeItem` global directly. This port
 * routes through `shared/lib/storage.ts`'s `createStorage('local')` — the
 * ONLY sanctioned place to touch `localStorage` (spec §5.4/R-A1's storage
 * analogue) — which also means these transient keys are swept by
 * `clearNamespace()` on logout if a race ever leaves one behind. The key
 * name changes from raw `mcp-auth-result-{state}` to the namespaced
 * `el.mcp-auth-result-{state}`; both the writer (`pages/mcps`'s callback
 * page) and this reader go through the same wrapper, so the rename is
 * invisible to behaviour.
 */
import { createStorage } from '@/shared/lib/storage';

import { MCP_SESSION_CONFIG } from './constants';

const AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes.

function localStore() {
  return createStorage('local');
}

function crossTabKey(state: string): string {
  return `mcp-auth-result-${state}`;
}

/** Opens a blank popup with a "preparing authorization" placeholder, sized per `MCP_SESSION_CONFIG.POPUP_SIZE`. Returns `null` if the popup was blocked. */
export function openAuthPopup(): Window | null {
  const { width, height } = MCP_SESSION_CONFIG.POPUP_SIZE;
  const popup = window.open('about:blank', '_blank', `width=${width},height=${height}`);
  if (popup) {
    const doc = popup.document;
    doc.body.style.cssText = 'font-family: sans-serif; padding: 20px; text-align: center;';
    const h2 = doc.createElement('h2');
    h2.textContent = 'Preparing authorization...';
    const p = doc.createElement('p');
    p.textContent = 'Please wait while we set up the authentication.';
    doc.body.appendChild(h2);
    doc.body.appendChild(p);
  }
  return popup;
}

export function navigateAuthPopup(authWindow: Window, authUrl: string): void {
  if (authWindow.closed) {
    throw new Error('Authorization window was closed');
  }
  authWindow.location.href = authUrl;
}

/** The shape `/mcp-auth-callback` (pages/mcps) relays back via postMessage/BroadcastChannel/localStorage. */
interface AuthResultMessage {
  type: 'mcp-auth-code' | 'mcp-auth-result';
  state?: string;
  code?: string;
  error?: string;
  error_description?: string;
  success?: boolean;
  tokenData?: unknown;
}

function isValidAuthMessage(data: Partial<AuthResultMessage> | null | undefined, state: string): data is AuthResultMessage {
  return (data?.type === 'mcp-auth-code' || data?.type === 'mcp-auth-result') && data.state === state;
}

/**
 * Listens for the popup's authorization result via three independent
 * channels (postMessage, BroadcastChannel, localStorage-as-signal) so
 * delivery survives `window.opener` being severed by the popup navigating
 * cross-origin to the MCP server's own auth page. Resolves via `onSuccess`
 * (a `{code}` or a full `{success:true, tokenData}` result) or rejects via
 * `onError`. Returns a cleanup function the caller can invoke to cancel
 * early (e.g. user closed the modal).
 */
export function createAuthorizationMonitor(
  _authWindow: Window | null,
  state: string,
  onSuccess: (result: { code?: string; success?: boolean; tokenData?: unknown }) => void,
  onError: (error: Error) => void,
): () => void {
  let isCleanedUp = false;
  let broadcastChannel: BroadcastChannel | null = null;

  const timeoutId = setTimeout(() => {
    if (!isCleanedUp) {
      cleanup();
      onError(new Error('Authorization timed out. Please try again.'));
    }
  }, AUTHORIZATION_TIMEOUT_MS);

  function cleanup(): void {
    if (isCleanedUp) return;
    isCleanedUp = true;
    window.removeEventListener('message', postMessageHandler);
    window.removeEventListener('storage', storageHandler);
    if (broadcastChannel) {
      broadcastChannel.close();
      broadcastChannel = null;
    }
    clearTimeout(timeoutId);
    try {
      localStore().remove(crossTabKey(state));
    } catch {
      // Best-effort cleanup only.
    }
  }

  function handleAuthResult(data: Partial<AuthResultMessage> | null | undefined): boolean {
    if (!isValidAuthMessage(data, state)) return false;
    cleanup();

    if (data.error) {
      onError(new Error(data.error_description || data.error));
    } else if (data.type === 'mcp-auth-result' && data.success && data.tokenData) {
      onSuccess(data);
    } else if (data.code) {
      onSuccess({ code: data.code });
    } else {
      onError(new Error('No authorization result received'));
    }
    return true;
  }

  function postMessageHandler(event: MessageEvent): void {
    if (event.origin !== window.location.origin) return;
    handleAuthResult((event.data as Partial<AuthResultMessage> | null | undefined) ?? {});
  }
  window.addEventListener('message', postMessageHandler);

  try {
    broadcastChannel = new BroadcastChannel(`mcp-auth-${state}`);
    broadcastChannel.onmessage = (event: MessageEvent) => {
      handleAuthResult(event.data as Partial<AuthResultMessage> | null | undefined);
    };
  } catch {
    // BroadcastChannel unsupported — postMessage + localStorage channels still cover it.
  }

  function storageHandler(event: StorageEvent): void {
    if (event.key !== `el.${crossTabKey(state)}` || !event.newValue) return;
    try {
      handleAuthResult(JSON.parse(event.newValue) as Partial<AuthResultMessage>);
    } catch {
      // Malformed payload — ignore, matches baseline's silent-drop posture.
    }
  }
  window.addEventListener('storage', storageHandler);

  // The callback may have already written the result before this listener attached.
  try {
    const existing = localStore().getJSON<Partial<AuthResultMessage>>(crossTabKey(state));
    if (existing) {
      setTimeout(() => handleAuthResult(existing), 0);
    }
  } catch {
    // Best-effort only.
  }

  return cleanup;
}
