/**
 * Local duplicate of `apps/elitea-ui/src/hooks/useIsSmallWindow.js`, needed
 * by this unit's own `../../ui/folders/Folders.tsx` (baseline:
 * `Folders.jsx:12,26` — `collapsed={collapsed && !isSmallWindow}`, a
 * mobile-responsive override that ignores an externally-collapsed sidebar
 * once the viewport itself is narrow).
 *
 * `no-sideways-features` forbids importing `features/pipelines/lib/hooks/
 * useIsSmallWindow.ts` (Wave-2 unit A2n), which already ports this exact
 * baseline file byte-for-byte — duplicated here instead, per that same
 * file's own doc comment precedent ("a genuinely-needed, not-owned,
 * not-yet-landed dependency ... duplicated locally rather than invented or
 * skipped"). `MIN_LARGE_WINDOW_WIDTH` itself IS `shared/lib`-owned (unit
 * S3) and is reused, not re-declared.
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
