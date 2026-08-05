/**
 * Ported from `apps/elitea-ui/src/components/Chat/FullScreenToggle.jsx` —
 * a hook for toggling full-screen mode on the chat panel.
 *
 * Port of `apps/elitea-ui/src/components/Chat/FullScreenToggle.jsx`.
 */
import { useCallback, useState } from 'react';

/** @public Result of `useFullScreenToggle`. */
export interface UseFullScreenToggleResult {
  /** Whether the chat is in full-screen mode. */
  readonly isFullScreen: boolean;
  /** Toggle full-screen mode. */
  readonly toggleFullScreen: () => void;
  /** Exit full-screen mode. */
  readonly exitFullScreen: () => void;
}

/**
 * `useFullScreenToggle` — manages full-screen mode state for the
 * chat panel. Toggles a CSS class on the parent container.
 */
export function useFullScreenToggle(): UseFullScreenToggleResult {
  const [isFullScreen, setIsFullScreen] = useState(false);

  const toggleFullScreen = useCallback(() => {
    setIsFullScreen((prev) => !prev);
  }, []);

  const exitFullScreen = useCallback(() => {
    setIsFullScreen(false);
  }, []);

  return { isFullScreen, toggleFullScreen, exitFullScreen };
}
