/**
 * Local duplicate of `notifyTaskComplete` from `apps/elitea-ui/src/[fsd]/
 * shared/lib/utils/soundNotification.utils.js:79-101,93-101,6-19` (unit
 * A2c's only consumer: `parseRunsByEvent.helpers.ts`'s `PipelineFinish`
 * case).
 *
 * **Why local, not imported:** the baseline path puts this file in
 * `shared/lib/`, but unit A11 (`features/notifications/lib/
 * soundNotification.ts`) ported only the subset ITS OWN scope needed
 * (`loadSoundConfig`/`saveSoundConfig`/`playCompletionSound`/
 * `playErrorSound`) and explicitly documented `notifyTaskComplete` as
 * out-of-scope there ("the old file's OTHER consumers are ... not landed").
 * `features/pipelines` importing from `features/notifications` would violate
 * `.dependency-cruiser.cjs`'s `no-sideways-features` rule regardless (no
 * carve-out). Per this mission's stated precedent for a not-owned,
 * not-promoted dependency, this is a minimal local duplicate of exactly the
 * one function this unit's port needs — not a second copy of the tone
 * catalogue's sibling functions (`playErrorSound`, `notifyTaskError`, config
 * persistence) that this unit never calls.
 *
 * Storage: reads the same `el.*`-namespaced config unit A11 already writes
 * (`shared/lib/storage.ts`, key `notifications.sound-config`) so a user's
 * sound preference is honoured consistently regardless of which unit's copy
 * of `loadSoundConfig` executes it — see A11's `soundNotification.ts` module
 * doc comment for the storage-key/namespace rationale (spec §5.4/unit F4).
 */
import { createStorage } from '@/shared/lib/storage';

interface SoundNotificationConfig {
  readonly enabled: boolean;
  readonly volume: number;
}

const DEFAULT_CONFIG: SoundNotificationConfig = { enabled: true, volume: 0.5 };
const STORAGE_KEY = 'notifications.sound-config';

function isValidConfig(raw: unknown): SoundNotificationConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const candidate = raw as Record<string, unknown>;
  const enabled = typeof candidate['enabled'] === 'boolean' ? candidate['enabled'] : DEFAULT_CONFIG.enabled;
  const volume =
    typeof candidate['volume'] === 'number'
      ? Math.max(0, Math.min(1, candidate['volume']))
      : DEFAULT_CONFIG.volume;
  return { enabled, volume };
}

function loadSoundConfig(): SoundNotificationConfig {
  const storage = createStorage('local');
  return storage.getJSON(STORAGE_KEY, isValidConfig) ?? { ...DEFAULT_CONFIG };
}

interface WindowWithWebkitAudioContext extends Window {
  webkitAudioContext?: typeof AudioContext;
}

let sharedAudioCtx: AudioContext | null = null;

/** Test-only reset — mirrors `features/notifications/lib/soundNotification.ts`'s identically-named export for the same reason: without it, a later test's fake `AudioContext` class silently loses to a still-"running" instance a prior test constructed. */
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
      // Handled: a resume rejection just means the tone doesn't play.
    });
  }
  return sharedAudioCtx;
}

function playTone(
  audioCtx: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  gainValue: number,
): void {
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

/** Final completion of a pipeline run — ascending two-tone "ding" (`soundNotification.utils.js:80-84`). */
function playCompletionSound(): void {
  const { enabled, volume } = loadSoundConfig();
  if (!enabled) return;

  try {
    const audioCtx = getAudioContext();
    if (audioCtx === null) return;
    const now = audioCtx.currentTime;
    playTone(audioCtx, 880, now, 0.15, volume * 0.4);
    playTone(audioCtx, 1108, now + 0.12, 0.25, volume * 0.35);
  } catch {
    // Handled: Web Audio API unavailable — no sound, no crash.
  }
}

/**
 * True when the user is not actively looking at the page that ran the task:
 * the tab is backgrounded/minimized (`document.hidden`) or the window lost
 * focus. `soundNotification.utils.js:93-101`.
 */
function isPageInactive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.hidden || !document.hasFocus();
}

/**
 * Notifies (with sound) that a pipeline run finished — only when the page is
 * inactive, so users actively watching stay uninterrupted.
 * `soundNotification.utils.js:106-108`.
 */
export function notifyTaskComplete(): void {
  if (isPageInactive()) playCompletionSound();
}
