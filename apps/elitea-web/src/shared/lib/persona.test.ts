import { describe, expect, it } from 'vitest';

import { DEFAULT_PERSONA, PERSONA_OPTIONS } from './persona';

describe('PERSONA_OPTIONS', () => {
  it('has 7 personas including the DEFAULT_PERSONA value', () => {
    expect(PERSONA_OPTIONS).toHaveLength(7);
    expect(PERSONA_OPTIONS.map((p) => p.value)).toContain(DEFAULT_PERSONA);
  });

  it('preserves the exact "bare" persona description', () => {
    const bare = PERSONA_OPTIONS.find((p) => p.value === 'bare');
    expect(bare?.description).toBe('No Elitea identity — only your instructions plus tool-required guidance');
  });

  it('DEFAULT_PERSONA is "generic"', () => {
    expect(DEFAULT_PERSONA).toBe('generic');
  });
});
