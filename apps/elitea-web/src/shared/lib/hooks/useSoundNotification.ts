/**
 * Sound notification settings hook.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/shared/lib/hooks/useSoundNotification.hooks.js`
 * and `apps/elitea-ui/src/[fsd]/shared/lib/utils/soundNotification.utils.js`.
 *
 * Persists `{ enabled, volume }` to localStorage under key `el.notifications.sound-config`.
 *
 * **Storage key fix (was `sound_notifications`):** this hook backs the
 * Settings > Profile "Play sound when tasks complete" toggle, but the actual
 * sound-playing call sites — `features/notifications/lib/soundNotification.ts`,
 * `features/pipelines/lib/flow-editor/helpers/pipelineCompletionSound.local.ts`,
 * and `features/toolkits/indexes/lib/helpers/soundNotification.local.ts` — all
 * read/write `notifications.sound-config`. Using a different key here meant
 * toggling the Settings switch off never actually silenced those sounds.
 * Aligning on the shared key is a one-time reset of this preference for any
 * user who had already stored a value under the old key (a boolean + volume
 * slider, not user content) — no migration is performed.
 */
import { useCallback, useState } from 'react';

import { createStorage } from '@/shared/lib/storage';

interface SoundConfig {
  enabled: boolean;
  volume: number;
}

const STORAGE_KEY = 'notifications.sound-config';
const DEFAULT_CONFIG: SoundConfig = { enabled: true, volume: 0.5 };

function loadSoundConfig(): SoundConfig {
  const store = createStorage('local');
  const raw = store.get(STORAGE_KEY);
  if (raw === null) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const p = parsed as Record<string, unknown>;
      return {
        enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_CONFIG.enabled,
        volume:
          typeof p.volume === 'number'
            ? Math.max(0, Math.min(1, p.volume))
            : DEFAULT_CONFIG.volume,
      };
    }
  } catch {
    // Ignore corrupt stored state — return defaults.
  }
  return { ...DEFAULT_CONFIG };
}

function saveSoundConfig(config: SoundConfig): void {
  try {
    const store = createStorage('local');
    store.set(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage write failure — silent.
  }
}

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    || (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

type ToneDef = { frequency: number; offset: number; duration: number; gain: number };

function playTone(audioCtx: AudioContext, frequency: number, startTime: number, duration: number, gainValue: number): void {
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gainNode.gain.setValueAtTime(gainValue, startTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

function playSequence(tones: ToneDef[]): void {
  const store = createStorage('local');
  const raw = store.get(STORAGE_KEY);
  let config: SoundConfig = DEFAULT_CONFIG;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        const p = parsed as Record<string, unknown>;
        config = {
          enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_CONFIG.enabled,
          volume:
            typeof p.volume === 'number'
              ? Math.max(0, Math.min(1, p.volume))
              : DEFAULT_CONFIG.volume,
        };
      }
    } catch {
      // Ignore corrupt state.
    }
  }
  if (!config.enabled) return;
  try {
    const audioCtx = getAudioContext();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    tones.forEach(({ frequency, offset, duration, gain }) =>
      playTone(audioCtx, frequency, now + offset, duration, (config.volume ?? 1) * gain),
    );
  } catch {
    // Web Audio API unavailable.
  }
}

/** Final completion sound — ascending two-tone "ding". */
export function playCompletionSound(): void {
  playSequence([
    { frequency: 880, offset: 0, duration: 0.15, gain: 0.4 },
    { frequency: 1108, offset: 0.12, duration: 0.25, gain: 0.35 },
  ]);
}

/** Error sound — descending two-tone. */
export function playErrorSound(): void {
  playSequence([
    { frequency: 440, offset: 0, duration: 0.18, gain: 0.4 },
    { frequency: 330, offset: 0.15, duration: 0.3, gain: 0.35 },
  ]);
}

/** True when the user is not actively looking at the page that ran the task. */
export function isPageInactive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.hidden || !document.hasFocus();
}

export interface UseSoundNotificationResult {
  config: SoundConfig;
  setConfig: (updates: Partial<SoundConfig>) => void;
  playCompletionSound: () => void;
  playErrorSound: () => void;
}

export function useSoundNotification(): UseSoundNotificationResult {
  const [config, setConfigState] = useState<SoundConfig>(loadSoundConfig);

  const setConfig = useCallback((updates: Partial<SoundConfig>) => {
    setConfigState((prev) => {
      const next = { ...prev, ...updates };
      saveSoundConfig(next);
      return next;
    });
  }, []);

  return { config, setConfig, playCompletionSound, playErrorSound };
}
