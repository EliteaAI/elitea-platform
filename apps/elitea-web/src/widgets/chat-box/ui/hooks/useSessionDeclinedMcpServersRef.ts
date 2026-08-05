/**
 * Split out of `ChatBox.tsx` to stay under the component-scoped use-effects
 * budget (§3.5) — session-scoped (never persisted) bookkeeping of MCP
 * servers declined/authenticated this conversation, reset whenever the
 * conversation changes (baseline: `ChatBox.jsx:611`).
 */
import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

export function useSessionDeclinedMcpServersRef(
  conversationUuid: string | undefined,
): RefObject<Map<string, Record<string, unknown>>> {
  const ref = useRef<Map<string, Record<string, unknown>>>(new Map());
  useEffect(() => {
    ref.current = new Map();
  }, [conversationUuid]);
  return ref;
}
