/**
 * features/notifications/lib/soundNotification.ts — partial port of
 * `apps/elitea-ui/src/[fsd]/shared/lib/utils/soundNotification.utils.js`
 * (unit A11), scoped to exactly what `useSoundNotification.hooks.js`
 * (this unit's assigned source file) consumes: `loadSoundConfig`,
 * `saveSoundConfig`, `playCompletionSound`, `playErrorSound`.
 *
 * **NOT ported here, on purpose:** `isPageInactive`/`notifyTaskComplete`/
 * `notifyTaskError` — the old file's OTHER consumers are chat completion/
 * error sounds (`processes/chat`, the C-series Wave-2 units, not landed).
 * This unit's `wave2-partition.json` entry lists only
 * `useSoundNotification.hooks.js`, whose own baseline consumer
 * (`SoundNotificationSection.jsx`) is itself outside this unit's ownership
 * (`pages/user-settings` -> unit A9) — see this unit's final report for the
 * full domain-boundary note. Porting the tone-playing primitives here (not
 * the task-completion gating) keeps this file genuinely self-contained
 * without reaching into chat's territory.
 *
 * **Storage key deviation from the baseline (deliberate, not a porting
 * miss):** the old app reads/writes the RAW `localStorage` key
 * `elitea_ui.sound_notifications` (`common/constants.js:668`,
 * `SoundNotificationsStorageKey` — already ported verbatim to
 * `shared/lib/legacy-storage-keys.ts` by unit S3, but explicitly flagged
 * there as "kept here, tested, so X5 has one verified source" for the
 * OLD-key migration list — and Wave 3 unit X5's own migration scope
 * (spec §9.3: "One-shot copy of `elitea_ui.project.id`,
 * `elitea_ui.project.name`, `mode` into `el.*`") does NOT include the sound
 * key). Per spec §5.4/unit F4, `shared/lib/storage.ts`'s namespaced `el.*`
 * wrapper is the ONE sanctioned way any new code touches
 * `localStorage`/`sessionStorage` (R-A4's sibling storage rule, enforced by
 * an `no-restricted-globals` override scoped to that one file). This module
 * therefore stores the sound-notification preference under the NEW `el.*`
 * namespace via `createStorage('local')` rather than reading the legacy
 * raw key — a fresh preference default for any user who had sound settings
 * under the old app, not a data-loss bug (the value is a single boolean +
 * volume slider, not user content).
 */
import { createStorage } from '@/shared/lib/storage';

export interface SoundNotificationConfig {
  readonly enabled: boolean;
  readonly volume: number;
}

const DEFAULT_CONFIG: SoundNotificationConfig = { enabled: true, volume: 0.5 };
const STORAGE_KEY = 'notifications.sound-config';

function isValidConfig(raw: unknown): SoundNotificationConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const candidate = raw as Record<string, unknown>;
  const enabled = typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_CONFIG.enabled;
  const volume = typeof candidate.volume === 'number' ? Math.max(0, Math.min(1, candidate.volume)) : DEFAULT_CONFIG.volume;
  return { enabled, volume };
}

/** `soundNotification.utils.js:6-17` parity (behaviour), new `el.*` storage (see module doc comment). */
export function loadSoundConfig(): SoundNotificationConfig {
  const storage = createStorage('local');
  return storage.getJSON(STORAGE_KEY, isValidConfig) ?? { ...DEFAULT_CONFIG };
}

/** `soundNotification.utils.js:19-23` parity. */
export function saveSoundConfig(config: SoundNotificationConfig): void {
  const storage = createStorage('local');
  storage.setJSON(STORAGE_KEY, config);
}

/* ── Web Audio tone synthesis (`soundNotification.utils.js:25-70`, verbatim) ── */

interface WindowWithWebkitAudioContext extends Window {
  webkitAudioContext?: typeof AudioContext;
}

let sharedAudioCtx: AudioContext | null = null;

/** Test-only reset — mirrors `shared/config/get-config.ts`'s `resetConfigForTests` / `shared/api/generated/mutator.ts`'s `resetGeneratedClient` pattern. */
export function resetSharedAudioContextForTests(): void {
  sharedAudioCtx = null;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext ?? (window as WindowWithWebkitAudioContext).webkitAudioContext;
  if (Ctx === undefined) return null;
  if (sharedAudioCtx === null || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctx();
  }
  // Background tabs auto-suspend the context; this feature fires precisely then.
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume().catch(() => {
      // Handled (§3.6): a resume rejection just means the tone doesn't play.
    });
  }
  return sharedAudioCtx;
}

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

interface ToneSpec {
  readonly frequency: number;
  readonly offset: number;
  readonly duration: number;
  /** 0..1 multiplier of the configured volume. */
  readonly gain: number;
}

function playSequence(tones: readonly ToneSpec[]): void {
  const { enabled, volume } = loadSoundConfig();
  if (!enabled) return;

  try {
    const audioCtx = getAudioContext();
    if (audioCtx === null) return;
    const now = audioCtx.currentTime;
    for (const tone of tones) {
      playTone(audioCtx, tone.frequency, now + tone.offset, tone.duration, volume * tone.gain);
    }
  } catch {
    // Handled (§3.6): Web Audio API unavailable — no sound, no crash.
  }
}

/** Final completion of a chat response or pipeline run — ascending two-tone "ding". */
export function playCompletionSound(): void {
  playSequence([
    { frequency: 880, offset: 0, duration: 0.15, gain: 0.4 },
    { frequency: 1108, offset: 0.12, duration: 0.25, gain: 0.35 },
  ]);
}

/** A failed tool or LLM step — descending two-tone. */
export function playErrorSound(): void {
  playSequence([
    { frequency: 440, offset: 0, duration: 0.18, gain: 0.4 },
    { frequency: 330, offset: 0.15, duration: 0.3, gain: 0.35 },
  ]);
}
