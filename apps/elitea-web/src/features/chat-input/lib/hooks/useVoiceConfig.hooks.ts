/**
 * Ported from
 * apps/elitea-ui/src/[fsd]/features/chat/voice-config/lib/hooks/useVoiceConfig.hooks.js.
 *
 * The baseline hand-rolls `localStorage.getItem/setItem` under an
 * un-namespaced key, `elitea_voice_config` (`STORAGE_KEY` there). This port
 * routes through `shared/lib/storage.ts`'s `createStorage('local')` instead
 * (spec §5.4 / unit F4: the ONE sanctioned way any new code touches
 * `localStorage`) — `getJSON`'s `validate` callback replaces the baseline's
 * hand-rolled `loadStored` try/catch + per-field clamping, and `setJSON`
 * replaces its `persist`-gated `localStorage.setItem` call. The legacy raw
 * key is preserved in `shared/lib/legacy-storage-keys.ts` (`VoiceConfigStorageKey`)
 * for the X5 migration list — see that file's own doc comment for the gap
 * this closes.
 */
import { useCallback, useEffect, useState } from 'react';

import { createStorage } from '@/shared/lib/storage';

const STORAGE_KEY = 'chat-input.voice-config';

/** @public The persisted (or session-local, when `persist:false`) voice preference. */
export interface VoiceConfig {
  readonly voiceName: string | null;
  readonly voiceId: string | null;
  readonly rate: number;
  readonly volume: number;
}

/** @public A partial update applied on top of the current `VoiceConfig`. */
export type VoiceConfigUpdate = Partial<VoiceConfig>;

const DEFAULT_CONFIG: VoiceConfig = { voiceName: null, voiceId: null, rate: 1.0, volume: 1.0 };

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' ? Math.max(min, Math.min(max, value)) : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** `useVoiceConfig.hooks.js:5-19` parity (`loadStored`'s try/catch + per-field clamp), as a `storage.ts` `validate` callback. */
function isValidVoiceConfig(raw: unknown): VoiceConfig {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_CONFIG;
  const candidate = raw as Record<string, unknown>;
  return {
    voiceName: stringOrNull(candidate.voiceName),
    voiceId: stringOrNull(candidate.voiceId),
    rate: clampNumber(candidate.rate, 0.5, 2, 1.0),
    volume: clampNumber(candidate.volume, 0, 1, 1.0),
  };
}

function loadStored(): VoiceConfig {
  return createStorage('local').getJSON(STORAGE_KEY, isValidVoiceConfig) ?? { ...DEFAULT_CONFIG };
}

/** @public */
export interface UseVoiceConfigOptions {
  /** @default true */
  readonly persist?: boolean;
}

/** @public */
export interface UseVoiceConfigResult {
  readonly config: VoiceConfig;
  readonly setConfig: (updates: VoiceConfigUpdate) => void;
  readonly browserVoices: readonly SpeechSynthesisVoice[];
  /** The `browserVoices` entry matching `config.voiceName`, or the first available voice — a stable reference so Chrome does not pick a different voice per utterance (`useVoiceConfig.hooks.js`'s own comment, preserved). */
  readonly resolvedBrowserVoice: SpeechSynthesisVoice | null;
}

/**
 * Voice/speed/volume preference, optionally persisted to `localStorage`
 * (`persist: false` — e.g. the transient preview instance `VoiceConfigDialog`
 * stages before Apply — keeps state in memory only).
 */
export function useVoiceConfig(options: UseVoiceConfigOptions = {}): UseVoiceConfigResult {
  const { persist = true } = options;
  const [config, setConfigState] = useState<VoiceConfig>(loadStored);
  const [browserVoices, setBrowserVoices] = useState<readonly SpeechSynthesisVoice[]>([]);

  // Chrome loads voices asynchronously.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = (): void => setBrowserVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const setConfig = useCallback(
    (updates: VoiceConfigUpdate) => {
      setConfigState((prev) => {
        const next = { ...prev, ...updates };
        if (persist) createStorage('local').setJSON(STORAGE_KEY, next);
        return next;
      });
    },
    [persist],
  );

  // Stable voice reference — prevents Chrome from picking a different voice per utterance.
  const resolvedBrowserVoice =
    browserVoices.find((voice) => voice.name === config.voiceName) ?? browserVoices[0] ?? null;

  return { config, setConfig, browserVoices, resolvedBrowserVoice };
}
