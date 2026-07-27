import { describe, expect, it } from 'vitest';

import { appDetailErrorMessage } from './errorMessage';

describe('appDetailErrorMessage', () => {
  it('returns an Error instance\'s own message', () => {
    expect(appDetailErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('falls back to String(error) for a non-Error value', () => {
    expect(appDetailErrorMessage('plain string')).toBe('plain string');
    expect(appDetailErrorMessage({ some: 'object' })).toBe('[object Object]');
    expect(appDetailErrorMessage(undefined)).toBe('undefined');
  });
});
