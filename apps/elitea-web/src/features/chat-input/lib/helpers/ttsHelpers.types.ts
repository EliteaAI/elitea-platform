/**
 * Shared types for the `tts.helpers.js` port, split out so
 * `ttsInline.helpers.ts`/`ttsBlock.helpers.ts`/`ttsHelpers.ts` can all
 * depend on the same shape without a circular import between the three.
 */

/**
 * A span of the ORIGINAL markdown mapped to a span of the STRIPPED
 * (speakable) text. Fields are intentionally NOT `readonly`:
 * `toSpeakableText`'s trailing leading-whitespace correction adjusts
 * `strippedStart` in place on the same segment objects `inlineTextSegments`/
 * `listSegments` constructed — `SpeakableText.segments`'s own `readonly
 * TtsSegment[]` (array-level, not field-level) is what a caller outside
 * this helper module actually sees.
 */
export interface TtsSegment {
  origStart: number;
  origLen: number;
  strippedStart: number;
  strippedLen: number;
}

/** @public */
export interface SpeakableText {
  readonly text: string;
  readonly segments: readonly TtsSegment[];
}
