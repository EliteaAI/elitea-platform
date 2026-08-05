/**
 * Local duplicate of `apps/elitea-ui/src/[fsd]/shared/lib/utils/
 * soundNotification.utils.js`, scoped to the two entry points
 * `indexChat.helpers.ts` calls (`notifyTaskComplete`/`notifyTaskError`).
 *
 * No promoted home exists for this: `shared/lib/notification.ts` (unit S3)
 * is a DIFFERENT thing with the same generic name — it ports
 * `common/constants.js`'s `NotificationType` enum (in-app notification
 * *categories*), not the audio-beep-on-task-completion feature this file
 * is. It is also not indexes-specific (the baseline's own doc comment:
 * "Final completion of a chat response OR PIPELINE RUN"), so this is the
 * same class of decision as `useSelectedProjectId.ts`'s local duplicate:
 * every Wave-2 unit whose chat surface wants audio feedback re-derives this
 * until a real `shared/` promotion happens.
 *
 * `features/notifications/lib/soundNotification.ts` (unit A11) already
 * ported the tone-playing half of the same baseline file and — per §5.4/
 * unit F4, `shared/lib/storage.ts`'s namespaced `el.*` wrapper is the ONE
 * sanctioned way any new code touches `localStorage` (a repo-wide
 * `no-restricted-globals` override scoped to that one file, no per-feature
 * carve-out) — deliberately moved OFF the baseline's raw
 * `elitea_ui.sound_notifications` key onto `createStorage('local')` with a
 * new logical key. This copy reuses A11's exact key
 * (`notifications.sound-config`) rather than inventing a second one, so the
 * "same setting, one value" invariant the baseline's shared key achieved
 * (this file's own original doc comment) still holds ACROSS this app's
 * several duplicated copies of the same feature — cannot import A11's file
 * directly (`no-sideways-features`), but the storage key is just a string
 * both copies happen to agree on.
 */
import { createStorage } from '@/shared/lib/storage';

const STORAGE_KEY = 'notifications.sound-config';

interface SoundConfig {
  readonly enabled: boolean;
  readonly volume: number;
}

const DEFAULT_CONFIG: SoundConfig = { enabled: true, volume: 0.5 };

function isValidConfig(raw: unknown): SoundConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const candidate = raw as Record<string, unknown>;
  const enabled = typeof candidate['enabled'] === 'boolean' ? candidate['enabled'] : DEFAULT_CONFIG.enabled;
  const volume =
    typeof candidate['volume'] === 'number' ? Math.max(0, Math.min(1, candidate['volume'])) : DEFAULT_CONFIG.volume;
  return { enabled, volume };
}

function loadSoundConfig(): SoundConfig {
  const storage = createStorage('local');
  return storage.getJSON(STORAGE_KEY, isValidConfig) ?? { ...DEFAULT_CONFIG };
}

let sharedAudioCtx: AudioContext | null = null;

/** Test-only reset — mirrors `features/notifications/lib/soundNotification.ts`'s identical `resetSharedAudioContextForTests`. */
export function resetSharedAudioContextForTests(): void {
  sharedAudioCtx = null;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctx();
  }
  // Background tabs auto-suspend the context; this feature fires precisely then.
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume().catch(() => {});
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

interface Tone {
  readonly frequency: number;
  readonly offset: number;
  readonly duration: number;
  /** 0..1 multiplier of the configured volume. */
  readonly gain: number;
}

function playSequence(tones: readonly Tone[]): void {
  const { enabled, volume } = loadSoundConfig();
  if (!enabled) return;

  try {
    const audioCtx = getAudioContext();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    for (const { frequency, offset, duration, gain } of tones) {
      playTone(audioCtx, frequency, now + offset, duration, volume * gain);
    }
  } catch {
    /* Web Audio API unavailable */
  }
}

/** Final completion of a chat response or index run — ascending two-tone "ding". */
function playCompletionSound(): void {
  playSequence([
    { frequency: 880, offset: 0, duration: 0.15, gain: 0.4 },
    { frequency: 1108, offset: 0.12, duration: 0.25, gain: 0.35 },
  ]);
}

/** A failed tool or LLM step — descending two-tone. */
function playErrorSound(): void {
  playSequence([
    { frequency: 440, offset: 0, duration: 0.18, gain: 0.4 },
    { frequency: 330, offset: 0.15, duration: 0.3, gain: 0.35 },
  ]);
}

/**
 * True when the user is not actively looking at the page that ran the task:
 * the tab is backgrounded/minimized (`document.hidden`) or the window lost
 * focus. Quick tasks finish while the user is still watching, so this
 * naturally limits audible feedback to long-running tasks they stepped
 * away from.
 */
function isPageInactive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.hidden || !document.hasFocus();
}

export function notifyTaskComplete(): void {
  if (isPageInactive()) playCompletionSound();
}

export function notifyTaskError(): void {
  if (isPageInactive()) playErrorSound();
}
