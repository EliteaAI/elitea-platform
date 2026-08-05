/**
 * Refresh-queue management — the second half of
 * apps/elitea-ui/src/[fsd]/features/mcp/lib/helpers/mcpAuth.helpers.js
 * (unit A5, spec §9.3), split out of `storage.ts` for the §3.5 400-line
 * budget (see that file's header for the split rationale). Covers the old
 * file's `// === Refresh Queue Management ===` section (line 301 onward):
 * `markRefreshPending`/`clearRefreshPending`/`getServersNeedingRefresh`,
 * the serialised refresh queue, `getAllTokens()` (what the socket
 * `mcp_tokens` payload is built from), and `startTokenRefreshScheduler()`.
 *
 * The actual network refresh call (`triggerProactiveRefresh`'s inner async
 * work) lives in `oauthFlow.ts` — this module owns WHEN a refresh fires,
 * not HOW. `oauthFlow.ts` imports `markRefreshPending`/`clearRefreshPending`
 * from here; this module takes a refresh-trigger callback via
 * `configureRefreshTrigger()` (factory/inject, not a static import cycle,
 * since `oauthFlow.ts` needs `getServersNeedingRefresh` from here too).
 */
import { _loadTokens as loadTokens, getStorageKey, isExpired, needsProactiveRefresh } from './storage';
import type { StoredMcpToken } from './types';

const REFRESH_CHECK_INTERVAL_MS = 60 * 1000; // Re-check for refresh needs every 60s.
const REFRESH_DELAY_BETWEEN_REQUESTS_MS = 2000; // Stagger refresh requests to avoid a traffic storm.

const pendingRefreshes = new Set<string>();
let lastRefreshCheckTime = 0;
const refreshQueue: string[] = [];
let isProcessingRefreshQueue = false;

/** Injected by `oauthFlow.ts` at module init — the actual refresh network call. Factory/inject (R-S2), not a static circular import. */
let refreshTrigger: ((storageKey: string) => void) | null = null;

export function configureRefreshTrigger(trigger: (storageKey: string) => void): void {
  refreshTrigger = trigger;
}

/** Test-only reset, mirrors `shared/api/generated/mutator.ts`'s `resetGeneratedClient` pattern. */
export function resetRefreshQueueState(): void {
  pendingRefreshes.clear();
  refreshQueue.length = 0;
  isProcessingRefreshQueue = false;
  lastRefreshCheckTime = 0;
  refreshTrigger = null;
}

export function markRefreshPending(serverUrl?: string, toolkitType?: string): void {
  const key = getStorageKey({ serverUrl, toolkitType });
  if (key) pendingRefreshes.add(key);
}

export function clearRefreshPending(serverUrl?: string, toolkitType?: string): void {
  const key = getStorageKey({ serverUrl, toolkitType });
  if (key) pendingRefreshes.delete(key);
}

function hasRefreshableFields(tokenInfo: StoredMcpToken): boolean {
  return Boolean(tokenInfo.refresh_token && tokenInfo.access_token && tokenInfo.toolkit_id && tokenInfo.project_id);
}

function isEligibleForRefresh(storageKey: string, tokenInfo: StoredMcpToken): boolean {
  if (pendingRefreshes.has(storageKey)) return false;
  if (isExpired(tokenInfo) || !needsProactiveRefresh(tokenInfo)) return false;
  return hasRefreshableFields(tokenInfo);
}

/** Storage keys whose token is not-yet-expired, past the proactive-refresh threshold, has everything a refresh needs, and isn't already in flight. */
export function getServersNeedingRefresh(): string[] {
  const tokens = loadTokens();
  const serversToRefresh: string[] = [];

  for (const [storageKey, tokenInfo] of Object.entries(tokens)) {
    if (isEligibleForRefresh(storageKey, tokenInfo)) serversToRefresh.push(storageKey);
  }

  return serversToRefresh;
}

async function processRefreshQueue(): Promise<void> {
  if (isProcessingRefreshQueue || refreshQueue.length === 0) return;
  isProcessingRefreshQueue = true;

  while (refreshQueue.length > 0) {
    const storageKey = refreshQueue.shift();
    if (storageKey === undefined) continue;
    if (pendingRefreshes.has(storageKey)) continue;

    try {
      refreshTrigger?.(storageKey);
    } catch {
      // Best-effort: a synchronous throw from the trigger must not stall the rest of the queue.
    }

    if (refreshQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, REFRESH_DELAY_BETWEEN_REQUESTS_MS));
    }
  }

  isProcessingRefreshQueue = false;
}

function addToRefreshQueue(storageKeys: readonly string[]): void {
  for (const storageKey of storageKeys) {
    if (!refreshQueue.includes(storageKey)) refreshQueue.push(storageKey);
  }
}

type McpTokenEntry = { access_token: string | null; session_id: string | null; refresh_token?: string };

/**
 * One stored token -> its `mcp_tokens` wire entry, or `null` when it should
 * be dropped entirely (no usable `access_token`, or expired with nothing to
 * refresh it with). Split out of `getAllTokens` (§3.5 complexity budget: the
 * inlined loop body measured 13).
 */
function toMcpTokenEntry(value: StoredMcpToken): McpTokenEntry | null {
  if (!value?.access_token || value.access_token === '__connection_verified__') return null;
  const expired = isExpired(value);
  if (expired && !value.refresh_token) return null;
  return {
    access_token: expired ? null : value.access_token,
    session_id: expired ? null : (value.session_id ?? null),
    ...(value.refresh_token ? { refresh_token: value.refresh_token } : {}),
  };
}

/**
 * The `Dict[str, Dict]` shape the backend's `mcp_tokens` field expects
 * (URL/toolkit-type -> `{access_token, session_id, refresh_token?}`).
 * Expired-but-refreshable tokens are included with `access_token: null` so
 * the backend can refresh before use without forcing re-authorization;
 * expired tokens with no `refresh_token` are dropped entirely. Rate-limited
 * to once per `REFRESH_CHECK_INTERVAL_MS`: also fires the proactive-refresh
 * queue as a side effect on each check (fire-and-forget).
 */
export function getAllTokens(): Record<string, McpTokenEntry> {
  const tokens = loadTokens();
  const result: Record<string, McpTokenEntry> = {};

  for (const [key, value] of Object.entries(tokens)) {
    const entry = toMcpTokenEntry(value);
    if (entry) result[key] = entry;
  }

  const now = Date.now();
  if (now - lastRefreshCheckTime < REFRESH_CHECK_INTERVAL_MS) {
    return result;
  }
  lastRefreshCheckTime = now;

  const serversToRefresh = getServersNeedingRefresh();
  if (serversToRefresh.length > 0) {
    addToRefreshQueue(serversToRefresh);
    void processRefreshQueue();
  }

  return result;
}

/**
 * Background scheduler: re-checks every `REFRESH_CHECK_INTERVAL_MS` even
 * when the user is idle (complements `getAllTokens()`'s per-message check,
 * which only fires during active use). Returns a cleanup function — call on
 * unmount.
 */
export function startTokenRefreshScheduler(): () => void {
  const intervalId = setInterval(() => {
    const serversToRefresh = getServersNeedingRefresh();
    if (serversToRefresh.length > 0) {
      addToRefreshQueue(serversToRefresh);
      void processRefreshQueue();
    }
    // Keep getAllTokens()'s rate-limiter in sync so a message sent right
    // after a scheduler tick doesn't trigger a second, redundant check.
    lastRefreshCheckTime = Date.now();
  }, REFRESH_CHECK_INTERVAL_MS);

  return () => clearInterval(intervalId);
}
