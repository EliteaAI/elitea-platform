import { describe, expect, it } from 'vitest';

import { applicationErrorMessage } from './errorMessage';

describe('applicationErrorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(applicationErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns a subclassed Error message (e.g. EliteaApiError) unchanged', () => {
    class FakeEliteaApiError extends Error {}
    expect(applicationErrorMessage(new FakeEliteaApiError('eliteaFetch: 400 from /x'))).toBe(
      'eliteaFetch: 400 from /x',
    );
  });

  it('stringifies a non-Error value', () => {
    expect(applicationErrorMessage('plain string')).toBe('plain string');
    expect(applicationErrorMessage(404)).toBe('404');
    expect(applicationErrorMessage(undefined)).toBe('undefined');
    expect(applicationErrorMessage(null)).toBe('null');
  });
});
