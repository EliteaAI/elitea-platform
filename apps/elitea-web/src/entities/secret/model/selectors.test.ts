import { describe, expect, it } from 'vitest';

import { filterSecretsByName, isSecretHideable, maskSecretValue } from './selectors';
import type { Secret } from './types';

const secret = (name: string, isDefault = false): Secret => ({ name, secretName: `***${name}`, isDefault });

describe('isSecretHideable', () => {
  it('is true for a non-default secret', () => {
    expect(isSecretHideable(secret('a'))).toBe(true);
  });

  it('is false for the default secret', () => {
    expect(isSecretHideable(secret('a', true))).toBe(false);
  });
});

describe('maskSecretValue', () => {
  it('returns the masked reference value, not a plaintext value', () => {
    expect(maskSecretValue(secret('api-key'))).toBe('***api-key');
  });
});

describe('filterSecretsByName', () => {
  const secrets = [secret('DB_PASSWORD'), secret('DB_HOST'), secret('API_KEY')];

  it('matches case-insensitive substrings', () => {
    expect(filterSecretsByName(secrets, 'db_').map((s) => s.name)).toEqual(['DB_PASSWORD', 'DB_HOST']);
  });

  it('returns every secret for a blank query', () => {
    expect(filterSecretsByName(secrets, '')).toEqual(secrets);
  });
});
