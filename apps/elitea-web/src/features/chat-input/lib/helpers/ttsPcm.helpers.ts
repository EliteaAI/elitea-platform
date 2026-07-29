/**
 * Ported from `useTextToSpeech.hooks.js:78-90,545-560` — PCM16-LE decode and
 * linear fade-in/out, used by `useModelTtsEngine.hooks.ts`'s socket audio-
 * chunk handler. Pure — no AudioContext/DOM dependency — split out for
 * independent unit testing.
 */

/**
 * `tts_audio_chunk`'s `audio` field is typed `unknown` at the socket-contract
 * layer (`shared/api/socket/events.ts`'s own doc comment: "not zod-
 * structurally representable, validated as present"). Narrows to the two
 * real runtime shapes socket.io-client ever delivers binary payloads as.
 */
function toUint8Array(audio: unknown): Uint8Array<ArrayBuffer> | null {
  if (audio instanceof ArrayBuffer) return new Uint8Array(audio);
  // `ArrayBufferView.buffer` is typed `ArrayBufferLike` (it also covers
  // `SharedArrayBuffer`), but socket.io-client never delivers a binary
  // payload backed by one — real-world browser WebSocket/binary frames are
  // always a plain `ArrayBuffer`.
  if (ArrayBuffer.isView(audio)) return new Uint8Array(audio.buffer as ArrayBuffer, audio.byteOffset, audio.byteLength);
  return null;
}

/**
 * Decode raw binary PCM-16-LE to a `Float32Array` of normalised [-1, 1]
 * samples. Returns an empty array (never throws) for a payload that is
 * neither an `ArrayBuffer` nor a typed-array view — handled (§3.6): a
 * malformed/unexpected socket payload degrades to silence, not a crash.
 */
export function decodePcm16(audio: unknown): Float32Array<ArrayBuffer> {
  const bytes = toUint8Array(audio);
  if (bytes === null) return new Float32Array(0);
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768.0;
  }
  return samples;
}

/**
 * Applies a linear fade-in or fade-out over `fadeSamples` samples IN PLACE.
 * Used to eliminate amplitude-discontinuity "pops" at sentence boundaries
 * (fade-out the tail of a pending chunk right before scheduling it, fade-in
 * the head of the first chunk of the next sentence).
 */
export function applyFade(samples: Float32Array<ArrayBuffer>, fadeSamples: number, type: 'in' | 'out'): void {
  const count = Math.min(fadeSamples, samples.length);
  if (type === 'in') {
    for (let i = 0; i < count; i++) {
      samples[i] = (samples[i] ?? 0) * (i / count);
    }
  } else {
    const start = samples.length - count;
    for (let i = 0; i < count; i++) {
      const idx = start + i;
      samples[idx] = (samples[idx] ?? 0) * ((count - 1 - i) / count);
    }
  }
}
