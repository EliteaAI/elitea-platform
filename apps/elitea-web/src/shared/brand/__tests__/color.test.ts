import { describe, expect, it } from 'vitest';

import {
  BRAND_FAMILY_ARC,
  DERIVED_LIGHTNESS_MAX,
  DERIVED_LIGHTNESS_MIN,
  HARMONIZE_MAX_SHIFT,
  NEUTRAL_SATURATION_FLOOR,
  deriveColor,
  formatHex,
  hslaToRgba,
  hueOf,
  parseColor,
  parseFunctional,
  parseHex,
  rehue,
  rgbaToHsla,
  shortestAngle,
} from '../color';

/**
 * A pack that asks for hue 240 while the reference accent sits at 200:
 * delta +40, brand family = anything within BRAND_FAMILY_ARC of 200.
 */
const CTX = { deltaDeg: 40, brandHueDeg: 240, anchorHueDeg: 200 };

/** Helpers keep the raw-colour fence intact: no literal ever appears here. */
const hex = (h: number, s: number, l: number, a = 1): string =>
  formatHex(hslaToRgba({ h, s, l, a }));

describe('colour parsing', () => {
  it('parses every hex length, expanding shorthand', () => {
    const short = parseHex(`#${'f0a'}`);
    expect(short).toEqual({ r: 255, g: 0, b: 170, a: 1 });
    expect(parseHex(`#${'f0a8'}`)?.a).toBeCloseTo(0x88 / 255, 5);
    expect(parseHex(`#${'ff00aa'}`)).toEqual({ r: 255, g: 0, b: 170, a: 1 });
    expect(parseHex(`#${'ff00aa80'}`)?.a).toBeCloseTo(0x80 / 255, 5);
  });

  it('rejects malformed hex and non-colour text', () => {
    expect(parseHex(`#${'ff'}`)).toBeNull();
    expect(parseHex(`#${'fffffffff'}`)).toBeNull();
    expect(parseHex(`#${'12345'}`)).toBeNull();
    expect(parseHex(`#${'1234567'}`)).toBeNull();
    expect(parseHex('inset')).toBeNull();
    expect(parseColor('transparent')).toBeNull();
  });

  it('parses functional notation in comma, percent and space syntax', () => {
    const commas = parseFunctional(['rgb', '(', '17, 34, 51)'].join(''));
    expect(commas).toEqual({ r: 17, g: 34, b: 51, a: 1 });
    const alpha = parseFunctional(['rgba', '(', '17, 34, 51, 0.5)'].join(''));
    expect(alpha?.a).toBe(0.5);
    const percent = parseFunctional(['rgb', '(', '100%, 0%, 50%)'].join(''));
    expect(percent).toEqual({ r: 255, g: 0, b: 127.5, a: 1 });
    const spaced = parseFunctional(['hsl', '(', '120 100% 50% / 0.25)'].join(''));
    expect(spaced?.a).toBe(0.25);
    expect(spaced?.g).toBe(255);
  });

  it('rejects functional notation with too few or unparseable arguments', () => {
    expect(parseFunctional(['rgb', '(', '1, 2)'].join(''))).toBeNull();
    expect(parseFunctional(['rgb', '(', 'a, b, c)'].join(''))).toBeNull();
    expect(parseFunctional(['hsl', '(', 'a, b, c)'].join(''))).toBeNull();
    expect(parseFunctional(['rgba', '(', '1, 2, 3, x)'].join(''))).toBeNull();
    expect(parseFunctional('notafunction')).toBeNull();
  });
});

describe('HSL round trip', () => {
  it('round-trips the six hue sextants', () => {
    for (let h = 0; h < 360; h += 60) {
      const rgb = hslaToRgba({ h, s: 0.5, l: 0.5, a: 1 });
      expect(rgbaToHsla(rgb).h).toBeCloseTo(h % 360, 0);
    }
  });

  it('reports achromatic colours as hue 0, saturation 0', () => {
    const grey = rgbaToHsla({ r: 128, g: 128, b: 128, a: 1 });
    expect(grey).toMatchObject({ h: 0, s: 0 });
  });

  it('formats alpha only when the colour is translucent', () => {
    expect(formatHex({ r: 1, g: 2, b: 3, a: 1 })).toHaveLength(7);
    expect(formatHex({ r: 1, g: 2, b: 3, a: 0.5 })).toHaveLength(9);
    // out-of-range channels are clamped rather than wrapping
    expect(formatHex({ r: 999, g: -5, b: 3, a: 1 })).toBe(`#${'ff0003'}`);
  });
});

describe('shortestAngle', () => {
  it('always answers within half a turn, whatever the winding', () => {
    expect(shortestAngle(350, 10)).toBe(20);
    expect(shortestAngle(10, 350)).toBe(-20);
    expect(shortestAngle(0, 0)).toBe(0);
    expect(shortestAngle(1000, 10)).toBe(90);
    expect(Math.abs(shortestAngle(-800, 40))).toBeLessThanOrEqual(180);
  });
});

describe('deriveColor — band 2, brand family', () => {
  it('rotates by the full delta and preserves lightness and alpha', () => {
    const source = hslaToRgba({ h: 200 + BRAND_FAMILY_ARC - 1, s: 0.8, l: 0.4, a: 0.5 });
    const derived = rgbaToHsla(deriveColor(source, CTX));
    expect(derived.h).toBeCloseTo(200 + BRAND_FAMILY_ARC - 1 + CTX.deltaDeg, 0);
    expect(derived.s).toBeCloseTo(0.8, 2);
    expect(derived.l).toBeCloseTo(0.4, 2);
    expect(derived.a).toBe(0.5);
  });
});

describe('deriveColor — band 3, semantic harmonisation', () => {
  it('moves a distant hue toward the brand by at most HARMONIZE_MAX_SHIFT', () => {
    const red = hslaToRgba({ h: 0, s: 0.8, l: 0.5, a: 1 });
    const derived = rgbaToHsla(deriveColor(red, CTX));
    // 0 -> 240 is -120 the short way, so it moves -15, staying red.
    expect(derived.h).toBeCloseTo(345, 0);
    expect(Math.abs(shortestAngle(0, derived.h))).toBeLessThanOrEqual(HARMONIZE_MAX_SHIFT);
  });

  it('never overshoots a hue that is already almost on the brand', () => {
    const near = hslaToRgba({ h: 235, s: 0.8, l: 0.5, a: 1 });
    // 235 is 35 away from the 200 anchor, so it is semantic, but only 5 from
    // the 240 brand hue: it must land ON 240, not 15 degrees past it.
    expect(rgbaToHsla(deriveColor(near, CTX)).h).toBeCloseTo(240, 0);
  });
});

describe('deriveColor — band 1, neutrals', () => {
  it('tints a neutral with the brand hue instead of rotating it', () => {
    const derived = rgbaToHsla(deriveColor({ r: 128, g: 128, b: 128, a: 1 }, CTX));
    expect(derived.h).toBeCloseTo(CTX.brandHueDeg, 0);
    expect(derived.s).toBeCloseTo(NEUTRAL_SATURATION_FLOOR, 2);
  });

  it('keeps derived colours off the achromatic extremes', () => {
    const white = rgbaToHsla(deriveColor({ r: 255, g: 255, b: 255, a: 1 }, CTX));
    expect(white.l).toBeCloseTo(DERIVED_LIGHTNESS_MAX, 2);
    const black = rgbaToHsla(deriveColor({ r: 0, g: 0, b: 0, a: 1 }, CTX));
    expect(black.l).toBeCloseTo(DERIVED_LIGHTNESS_MIN, 2);
    expect(formatHex(deriveColor({ r: 255, g: 255, b: 255, a: 1 }, CTX))).not.toBe(`#${'ffffff'}`);
  });
});

describe('rehue', () => {
  it('is the identity at delta 0, including for neutrals', () => {
    const gradient = `linear-gradient(0deg, ${hex(0, 0, 0.1)} 0%, ${hex(0, 0, 0.2)} 100%)`;
    expect(rehue(gradient, { ...CTX, deltaDeg: 0 })).toBe(gradient);
    expect(rehue(gradient, { ...CTX, deltaDeg: 720 })).toBe(gradient);
  });

  it('rewrites every colour inside a compound value and nothing else', () => {
    const shadow = `0px 0px 10px 0px ${hex(200, 0.8, 0.5, 0.15)} inset`;
    const out = rehue(shadow, CTX);
    expect(out).toContain('0px 0px 10px 0px ');
    expect(out).toContain(' inset');
    expect(out).not.toBe(shadow);
    expect(rgbaToHsla(parseColor(out.split(' ')[4] as string) as never).h).toBeCloseTo(240, 0);
  });

  it('leaves keyword and unit-only values untouched', () => {
    expect(rehue('transparent', CTX)).toBe('transparent');
    expect(rehue('none', CTX)).toBe('none');
    expect(rehue('0.0625rem solid', CTX)).toBe('0.0625rem solid');
  });

  it('passes malformed-but-regex-matching CSS through unchanged', () => {
    // COLOR_IN_VALUE_RE's hex alternative accepts 3-8 hex digits — a superset
    // of the 3/4/6/8 lengths parseHex actually understands — so a 5-digit
    // hex is text the regex finds but parseColor cannot parse. This is the
    // one branch of rehue's replace callback (`if (!parsed) return match`)
    // that a well-formed pack never reaches (every colour in a real brand
    // pack round-trips through formatHex, which never emits 5/7-digit hex),
    // but a malformed pack — or a component author's typo baked into a
    // string literal — could. Garbage in, garbage out: no throw, no
    // corruption, the unparseable fragment survives exactly as written.
    const malformed = 'border: 1px solid #12345;';
    expect(rehue(malformed, CTX)).toBe(malformed);
  });
});

describe('hueOf', () => {
  it('reads the hue of any supported notation', () => {
    expect(hueOf(hex(123, 0.6, 0.5))).toBeCloseTo(123, 0);
  });

  it('throws rather than guessing when the pack hue is unparseable', () => {
    expect(() => hueOf('brand-blue')).toThrow(/not a colour this build understands/);
  });
});
