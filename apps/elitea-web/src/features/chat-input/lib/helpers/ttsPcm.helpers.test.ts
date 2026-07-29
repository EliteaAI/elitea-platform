import { describe, expect, it } from 'vitest';

import { applyFade, decodePcm16 } from './ttsPcm.helpers';

function int16LEBuffer(samples: readonly number[]): ArrayBuffer {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  samples.forEach((s, i) => view.setInt16(i * 2, s, true));
  return buf;
}

describe('decodePcm16', () => {
  it('decodes an ArrayBuffer of int16 LE samples into normalised [-1, 1] floats', () => {
    const buf = int16LEBuffer([0, 16384, -16384, 32767, -32768]);
    const samples = decodePcm16(buf);
    expect(samples.length).toBe(5);
    expect(samples[0]).toBeCloseTo(0);
    expect(samples[1]).toBeCloseTo(0.5, 3);
    expect(samples[2]).toBeCloseTo(-0.5, 3);
    expect(samples[3]).toBeCloseTo(1, 2);
    expect(samples[4]).toBeCloseTo(-1, 3);
  });

  it('decodes a typed-array VIEW over a larger buffer using its own byteOffset/byteLength', () => {
    const full = int16LEBuffer([111, 0, 16384, 999]);
    const view = new Uint8Array(full, 4, 2); // the single int16 sample "16384" (index 2, byte offset 4)
    const samples = decodePcm16(view);
    expect(samples.length).toBe(1);
    expect(samples[0]).toBeCloseTo(0.5, 3);
  });

  it('returns an empty array (no throw) for a payload that is neither ArrayBuffer nor a typed-array view', () => {
    expect(decodePcm16('not audio').length).toBe(0);
    expect(decodePcm16(null).length).toBe(0);
    expect(decodePcm16(undefined).length).toBe(0);
    expect(decodePcm16({}).length).toBe(0);
  });
});

describe('applyFade', () => {
  it('fades in from 0 up to (near) full amplitude over fadeSamples', () => {
    const samples = new Float32Array([1, 1, 1, 1]);
    applyFade(samples, 4, 'in');
    expect(samples[0]).toBeCloseTo(0);
    expect(samples[1]).toBeCloseTo(0.25);
    expect(samples[2]).toBeCloseTo(0.5);
    expect(samples[3]).toBeCloseTo(0.75);
  });

  it('fades out from (near) full amplitude down toward 0 over fadeSamples', () => {
    const samples = new Float32Array([1, 1, 1, 1]);
    applyFade(samples, 4, 'out');
    expect(samples[0]).toBeCloseTo(0.75);
    expect(samples[1]).toBeCloseTo(0.5);
    expect(samples[2]).toBeCloseTo(0.25);
    expect(samples[3]).toBeCloseTo(0);
  });

  it('only touches the last fadeSamples entries when fading out a longer buffer', () => {
    const samples = new Float32Array([2, 2, 2, 2, 2]);
    applyFade(samples, 2, 'out');
    expect(samples[0]).toBeCloseTo(2);
    expect(samples[1]).toBeCloseTo(2);
    expect(samples[2]).toBeCloseTo(2);
    expect(samples[3]).toBeCloseTo(1); // (2-1-0)/2 * 2 = 1
    expect(samples[4]).toBeCloseTo(0); // (2-1-1)/2 * 2 = 0
  });

  it('clamps fadeSamples to the buffer length when it exceeds it', () => {
    const samples = new Float32Array([1, 1]);
    expect(() => applyFade(samples, 100, 'in')).not.toThrow();
    expect(samples[0]).toBeCloseTo(0);
    expect(samples[1]).toBeCloseTo(0.5);
  });
});
