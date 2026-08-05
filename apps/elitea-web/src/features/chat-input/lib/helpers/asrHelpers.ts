/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/helpers/asr.helpers.js`
 * — a trivial pure classifier. Mirrors the backend `_is_whisper_model()`
 * check in `elitea_core/sio/asr.py`: returns `true` for batch HTTP
 * transcription models (whisper-1, gpt-4o-transcribe, etc.).
 *
 * Also consumed by the old app's `features/chat/ui/chat-button/VoiceButton.jsx`
 * (not part of this unit's own file set) to split a model list into
 * streaming vs. whisper buckets — kept on this slice's public barrel for
 * that reason.
 */
export function isWhisperModel(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower.includes('whisper') || lower.includes('transcribe');
}
