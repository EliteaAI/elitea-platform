/**
 * Local duplicate of `apps/elitea-ui/src/hooks/useIsSmallWindow.js` — a
 * generic `window.resize` listener that flips a boolean at
 * `MIN_LARGE_WINDOW_WIDTH` and fires an optional callback on each
 * true<->false transition (used by A2n's owned files to trigger a
 * `FlowEditor.fitView()` re-layout after the split direction/collapse state
 * changes).
 *
 * Not promoted, not `shared/lib`-owned, and NOT in this sub-unit's owned
 * old-app-file list — but four of A2n's own owned files
 * (`ConfigurationTab.jsx`, `EditorPanel.jsx`, `ChatPanel.jsx`,
 * `GeneralFormPanel.jsx`) each call it directly. Verified nowhere else in
 * this worktree (`grep -rn "useIsSmallWindow" src` — zero hits outside this
 * file and its call sites below), so — per this mission's established
 * precedent for a genuinely-needed, not-owned, not-yet-landed dependency —
 * duplicated locally rather than invented or skipped. `MIN_LARGE_WINDOW_WIDTH`
 * itself IS already ported (`shared/lib/layout.ts`, unit S3) and is reused
 * here, not re-declared.
 */
import { useCallback, useEffect, useState } from 'react';

import { MIN_LARGE_WINDOW_WIDTH } from '@/shared/lib/layout';

export interface UseIsSmallWindowResult {
  readonly isSmallWindow: boolean;
}

export function useIsSmallWindow(onResizeCallback?: () => void): UseIsSmallWindowResult {
  const [isSmallWindow, setIsSmallWindow] = useState(false);

  const onSize = useCallback(() => {
    const windowWidth = window.innerWidth;
    if (windowWidth < MIN_LARGE_WINDOW_WIDTH) {
      setIsSmallWindow((prev) => {
        if (!prev) onResizeCallback?.();
        return true;
      });
    } else {
      setIsSmallWindow((prev) => {
        if (prev) onResizeCallback?.();
        return false;
      });
    }
  }, [onResizeCallback]);

  useEffect(() => {
    onSize();
    window.addEventListener('resize', onSize);
    return () => window.removeEventListener('resize', onSize);
  }, [onSize]);

  return { isSmallWindow };
}
