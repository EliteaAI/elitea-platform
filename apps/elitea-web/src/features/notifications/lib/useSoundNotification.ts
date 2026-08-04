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
 *
 * **Confirmed adversarial-review finding, disclosed (blocked — the real fix
 * needs a file outside this cluster's `features/notifications/lib/` scope
 * fence, so it is documented here rather than silently left unfixed):** this
 * hook is not merely "not the baseline's importer" per the note above — it
 * is not imported by ANY live code path today. The actual Settings > Profile
 * "Play sound when tasks complete" toggle
 * (`features/settings/ui/profile/SoundNotificationSection.tsx`, via
 * `features/settings/ui/profile/SoundNotificationControls.tsx`) calls an
 * independently-forked duplicate, `shared/lib/hooks/useSoundNotification.ts`,
 * whose `STORAGE_KEY` is the raw string `'sound_notifications'`
 * (persisted as `el.sound_notifications`) — a DIFFERENT key from the one
 * THIS hook reads/writes via `./soundNotification`'s
 * `loadSoundConfig`/`saveSoundConfig`, `'notifications.sound-config'`
 * (persisted as `el.notifications.sound-config`; see that module's own doc
 * comment for the key's own rationale). Two already-live sound-playing call
 * sites outside this unit —
 * `features/pipelines/lib/flow-editor/helpers/pipelineCompletionSound.local.ts`
 * and `features/toolkits/indexes/lib/helpers/soundNotification.local.ts` —
 * both deliberately duplicate THIS hook's key, `notifications.sound-config`,
 * not the Settings screen's, citing (in their own doc comments) exactly this
 * unit's storage-key rationale so "a user's sound preference is honoured
 * consistently regardless of which unit's copy of `loadSoundConfig`
 * executes it." That makes `notifications.sound-config` the de-facto
 * canonical key every real sound-playing consumer already agrees on except
 * one: `shared/lib/hooks/useSoundNotification.ts` is the sole outlier, which
 * is why toggling the Settings switch off does not silence the sounds that
 * actually play (pipeline/toolkit completion tones keep firing regardless of
 * what the user set in Settings).
 *
 * **Precise fix needed outside this cluster's scope:** change
 * `shared/lib/hooks/useSoundNotification.ts`'s `STORAGE_KEY` constant
 * (currently `'sound_notifications'`) to `'notifications.sound-config'` so
 * the Settings toggle reads/writes the same key every live sound call site
 * already uses. That one-line change alone fixes the user-visible symptom.
 * A cleaner (larger, also out of this cluster's scope) follow-up would
 * retire `shared/lib/hooks/useSoundNotification.ts`'s and this file's
 * near-duplicate tone-synthesis code entirely in favor of ONE canonical
 * implementation promoted into `shared/lib/`, imported by both
 * `features/settings` and this feature — `features/settings` cannot import
 * this feature directly (`.dependency-cruiser.cjs`'s `no-sideways-features`
 * rule, R-L1 §3.2), so `shared/lib/` is the only layer both can legally
 * depend on. Either change lands in `shared/lib/hooks/useSoundNotification.ts`
 * and/or `features/settings/ui/profile/*`, both outside this pass's
 * assigned file scope, so it is not made here.
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
