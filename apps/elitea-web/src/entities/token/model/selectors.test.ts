import { describe, expect, it } from 'vitest';

import { maskedTokenValue, sortTokensByName, tokenExpiryInDays, tokenExpiryStatus } from './selectors';
import type { PersonalAccessToken } from './types';

const NOW = new Date('2026-01-01T00:00:00Z').getTime();
const DAY = 24 * 3600 * 1000;

const token = (name: string, expires: string | null): PersonalAccessToken => ({
  uuid: name,
  name,
  token: `sk-${name}-abcd1234`,
  expires,
});

describe('tokenExpiryInDays', () => {
  it('returns -1 for a null (never-expiring) token', () => {
    expect(tokenExpiryInDays(null, NOW)).toBe(-1);
  });

  it('rounds whole days when more than a day remains', () => {
    const expires = new Date(NOW + 10 * DAY).toISOString();
    expect(tokenExpiryInDays(expires, NOW)).toBe(10);
  });

  it('returns 1 when less than a day but still positive remains', () => {
    const expires = new Date(NOW + DAY / 2).toISOString();
    expect(tokenExpiryInDays(expires, NOW)).toBe(1);
  });

  it('returns 0 for an already-expired token', () => {
    const expires = new Date(NOW - DAY).toISOString();
    expect(tokenExpiryInDays(expires, NOW)).toBe(0);
  });

  it('returns 0 at exactly the expiry instant', () => {
    const expires = new Date(NOW).toISOString();
    expect(tokenExpiryInDays(expires, NOW)).toBe(0);
  });
});

describe('tokenExpiryStatus', () => {
  it('is safe for more than 7 days remaining', () => {
    expect(tokenExpiryStatus(new Date(NOW + 10 * DAY).toISOString(), NOW)).toBe('safe');
  });

  it('is warning at the 7-day boundary and below', () => {
    expect(tokenExpiryStatus(new Date(NOW + 7 * DAY).toISOString(), NOW)).toBe('warning');
    expect(tokenExpiryStatus(new Date(NOW + DAY / 2).toISOString(), NOW)).toBe('warning');
  });

  it('is never for a null expiry', () => {
    expect(tokenExpiryStatus(null, NOW)).toBe('never');
  });

  it('is expired for a past date', () => {
    expect(tokenExpiryStatus(new Date(NOW - DAY).toISOString(), NOW)).toBe('expired');
  });
});

describe('maskedTokenValue', () => {
  it('shows only the last 4 characters, prefixed with an ellipsis', () => {
    expect(maskedTokenValue(token('a', null))).toBe('...1234');
  });
});

describe('sortTokensByName', () => {
  it('sorts case-insensitively', () => {
    const tokens = [token('zeta', null), token('Alpha', null)];
    expect(sortTokensByName(tokens).map((t) => t.name)).toEqual(['Alpha', 'zeta']);
  });
});
