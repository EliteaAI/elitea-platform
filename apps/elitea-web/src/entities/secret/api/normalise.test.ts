import { describe, expect, it } from 'vitest';

import { normaliseSecrets } from './normalise';

describe('normaliseSecrets', () => {
  it('normalises a complete secret entry', () => {
    const wire = [{ name: 'MY_KEY', secret_name: 'MY_***', is_default: true }];
    expect(normaliseSecrets(wire)).toEqual([{ name: 'MY_KEY', secretName: 'MY_***', isDefault: true }]);
  });

  it('falls back secretName to name when secret_name is missing', () => {
    const wire = [{ name: 'KEY' }];
    expect(normaliseSecrets(wire)[0].secretName).toBe('KEY');
  });

  it('handles completely empty objects', () => {
    expect(normaliseSecrets([{}])).toEqual([{ name: '', secretName: '', isDefault: false }]);
  });

  it('handles empty array', () => {
    expect(normaliseSecrets([])).toEqual([]);
  });

  it('coerces non-string name to string', () => {
    const wire = [{ name: 123, secret_name: 'x', is_default: false }];
    expect(normaliseSecrets(wire)[0].name).toBe('123');
  });
});
