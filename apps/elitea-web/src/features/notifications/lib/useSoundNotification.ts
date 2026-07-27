/**
 * features/notifications/lib/useSoundNotification.ts — port of
 * `apps/elitea-ui/src/[fsd]/shared/lib/hooks/useSoundNotification.hooks.js`
 * (unit A11).
 *
 * **Domain-boundary note (disclosed, not silently reassigned):** this
 * hook's ONLY baseline consumer is
 * `apps/elitea-ui/src/[fsd]/pages/user-settings/ui/SoundNotificationSection.jsx`
 * — a personalization/settings screen, i.e. `pages/settings` (unit A9)
 * territory, not this unit's `ROUTE-062`/notifications-entity domain. It
 * was nonetheless listed verbatim in this unit's `wave2-partition.json`
 * `sourceFiles` array, so it is ported here, at the assigned path, per the
 * partition's mechanical ownership assignment — exported from this slice's
 * public `index.ts` for A9 (or any future consumer) to import.
 */
import { useCallback, useState } from 'react';

import type { SoundNotificationConfig } from './soundNotification';
import { loadSoundConfig, playCompletionSound, playErrorSound, saveSoundConfig } from './soundNotification';

export interface UseSoundNotificationResult {
  readonly config: SoundNotificationConfig;
  readonly setConfig: (updates: Partial<SoundNotificationConfig>) => void;
  readonly playCompletionSound: () => void;
  readonly playErrorSound: () => void;
}

export function useSoundNotification(): UseSoundNotificationResult {
  const [config, setConfigState] = useState<SoundNotificationConfig>(loadSoundConfig);

  const setConfig = useCallback((updates: Partial<SoundNotificationConfig>) => {
    setConfigState((prev) => {
      const next = { ...prev, ...updates };
      saveSoundConfig(next);
      return next;
    });
  }, []);

  return { config, setConfig, playCompletionSound, playErrorSound };
}
