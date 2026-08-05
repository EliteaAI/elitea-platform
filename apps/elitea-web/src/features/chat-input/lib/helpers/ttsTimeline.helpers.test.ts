import { describe, expect, it } from 'vitest';

import { PUNCTUATION_PAUSES, buildCharTimeline, findCharAtTime } from './ttsTimeline.helpers';

describe('buildCharTimeline', () => {
  it('advances each char by 1/charsPerSec seconds', () => {
    const { times, totalEstimated } = buildCharTimeline('abc', 10);
    expect(times[0]).toBeCloseTo(0);
    expect(times[1]).toBeCloseTo(0.1);
    expect(times[2]).toBeCloseTo(0.2);
    expect(times[3]).toBeCloseTo(0.3); // one-past-the-end sentinel
    expect(totalEstimated).toBeCloseTo(0.3);
  });

  it('inserts an extra pause after sentence-ending punctuation followed by a space', () => {
    const { times } = buildCharTimeline('a. b', 10);
    // index of 'b' (position 3) should be later than a bare 3-char advance
    // (0.3) by the '.' pause (0.25), since '.' at index 1 is followed by ' '.
    expect(times[3]).toBeCloseTo(0.3 + (PUNCTUATION_PAUSES['.'] ?? 0));
  });

  it('does NOT add a pause when the punctuation is not followed by whitespace/end-of-string', () => {
    const { times } = buildCharTimeline('3.14', 10);
    // '.' at index 1 is followed by '1', not whitespace/EOS — no extra pause.
    expect(times[2]).toBeCloseTo(0.2);
  });

  it('adds the pause when punctuation is the last character (end-of-string)', () => {
    const { totalEstimated } = buildCharTimeline('Hi!', 10);
    expect(totalEstimated).toBeCloseTo(0.3 + (PUNCTUATION_PAUSES['!'] ?? 0));
  });
});

describe('findCharAtTime', () => {
  it('returns 0 for t <= 0', () => {
    const { times } = buildCharTimeline('hello', 10);
    expect(findCharAtTime(times, 0)).toBe(0);
    expect(findCharAtTime(times, -1)).toBe(0);
  });

  it('returns the last real index when t is at or beyond the total', () => {
    const { times, totalEstimated } = buildCharTimeline('hello', 10);
    expect(findCharAtTime(times, totalEstimated)).toBe(times.length - 2);
    expect(findCharAtTime(times, totalEstimated + 10)).toBe(times.length - 2);
  });

  it('finds the largest index whose time is <= t, for a value strictly between two chars', () => {
    const { times } = buildCharTimeline('abcdef', 10);
    // times: 0, .1, .2, .3, .4, .5, .6 — t=0.25 should land on index 2 ('c').
    expect(findCharAtTime(times, 0.25)).toBe(2);
  });
});
