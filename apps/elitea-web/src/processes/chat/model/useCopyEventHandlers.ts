/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useCopyEventHandlers.js` — two
 * small, independent hooks:
 *
 *  - `useInteractionUUID`: generates ONE `crypto.randomUUID()` on first
 *    render and never regenerates it (a per-mount interaction id).
 *    **Correction (found by adversarial verify against the real old-app
 *    grep, not just this file's own prior claim): it has ZERO real
 *    consumers anywhere in `apps/elitea-ui/src/`.** `ApplicationAnswer.jsx`,
 *    `MermaidCodeBlock.jsx`, `CodeBlock.jsx`, `Canvas.jsx`,
 *    `MarkdownTableBlock.jsx`, and `useDownloadTable.js` all import this
 *    same module under the name `useCopyDownloadHandlers` (the file's
 *    *default* export, confusingly re-imported under its own name) — they
 *    consume THAT hook, not this one. `useInteractionUUID` is dead code in
 *    the baseline itself; ported faithfully (same file, same export shape)
 *    rather than dropped, since nothing in this unit's brief authorizes
 *    pruning baseline dead code, but it is not expected to gain a real
 *    caller here either.
 *  - `useCopyDownloadHandlers`: trivial `onClick`-safe wrappers around
 *    caller-supplied `onCopy`/`onDownload` callbacks (guards against
 *    `undefined`) — the hook all six files above actually use.
 *
 * **Confirmed NOT a duplicate of `useChatInteractionUUID.ts`** (this
 * cluster's brief flagged the near-duplicate name for a real-vs-dead-weight
 * check): `useChatInteractionUUID` regenerates its uuid every time
 * `activeConversationId` changes (a per-conversation id, consumed by
 * `pages/NewChat/NewChat.jsx` for message-send telemetry) — a real,
 * live consumer, unlike this file's `useInteractionUUID` above.
 *
 * `crypto.randomUUID()` replaces the baseline's `uuid` package (`uuidv4()`)
 * — this codebase's established substitute (no `uuid` dependency; see e.g.
 * `entities/conversation/lib/chat.helpers.ts`'s identical note).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseInteractionUUIDResult {
  readonly interaction_uuid: string;
}

/** Generates one `crypto.randomUUID()` on first render; stable for the component's lifetime. */
export function useInteractionUUID(): UseInteractionUUIDResult {
  const firstRender = useRef(true);
  const [interactionUuid, setInteractionUuid] = useState('');

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (!interactionUuid) setInteractionUuid(crypto.randomUUID());
    }
  }, [interactionUuid]);

  return { interaction_uuid: interactionUuid };
}

export interface UseCopyDownloadHandlersParams {
  readonly onCopy?: () => void;
  readonly onDownload?: (params?: unknown) => void;
}

export interface UseCopyDownloadHandlersResult {
  readonly onClickCopy: () => void;
  readonly onClickDownload: (params?: unknown) => void;
}

/** Guarded `onClick` wrappers around caller-supplied copy/download callbacks. */
export function useCopyDownloadHandlers(params: UseCopyDownloadHandlersParams): UseCopyDownloadHandlersResult {
  const { onCopy, onDownload } = params;

  const onClickCopy = useCallback(() => {
    onCopy?.();
  }, [onCopy]);

  const onClickDownload = useCallback(
    (downloadParams?: unknown) => {
      onDownload?.(downloadParams);
    },
    [onDownload],
  );

  return { onClickCopy, onClickDownload };
}
