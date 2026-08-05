/**
 * Shared types for the `useTextToSpeech.hooks.js` port, split out so the
 * public hook (`useTextToSpeech.hooks.ts`) and its two playback engines
 * (`useModelTtsEngine.hooks.ts`, `useBrowserTtsEngine.hooks.ts`) can all
 * depend on the same shapes without a circular import.
 */
import type { ModelListItem } from '../../api/models';

/** The server-side TTS model to speak through (`chat-input/api/models.ts`'s `section: 'tts'` row) — `null`/`undefined` falls back to the browser `SpeechSynthesis` engine. */
export type TtsModel = ModelListItem;

/**
 * Per-utterance voice/rate/volume, as consumed by BOTH playback engines.
 * `voice` (a `SpeechSynthesisVoice`) only matters to the browser engine;
 * `voiceId` only matters to the model engine — both fields are accepted
 * together so one `voiceConfig` object (built by `useReadAloud.hooks.ts`)
 * can be threaded through either backend without the caller needing to
 * know which one is active.
 */
export interface TtsVoiceConfig {
  readonly voice?: SpeechSynthesisVoice | null | undefined;
  readonly voiceId?: string | undefined;
  readonly rate?: number | undefined;
  readonly volume?: number | undefined;
}

/** `useTextToSpeech.hooks.js`'s state machine — idle \| playing \| paused \| done \| error. */
export type TtsStatus = 'idle' | 'playing' | 'paused' | 'done' | 'error';

/** A `[start, end)` character range of the currently-spoken word, for in-bubble highlight. */
export interface TtsSpokenRange {
  readonly start: number;
  readonly end: number;
}

/** What each playback engine (`useModelTtsEngine`/`useBrowserTtsEngine`) exposes to the outer `useTextToSpeech` hook — its own slice of the speak/pause/resume/stop public API, scoped to whichever backend is currently active. */
export interface TtsEngineHandle {
  readonly speak: (text: string) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly stop: () => void;
}
