import { describe, expect, it } from 'vitest';

import { applicationErrorMessage, applicationErrorMessageOrFallback } from './errorMessage';

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

  // A1-application-chat cluster, finding 3: this is exactly the shape that degrades to the
  // literal "[object Object]" — documented here (not "fixed" here) because `applicationErrorMessage`
  // itself is deliberately a plain stringify-everything helper; `applicationErrorMessageOrFallback`
  // below is the one that actually avoids leaking this literal to the user.
  it('degrades a plain object to the literal "[object Object]"', () => {
    expect(applicationErrorMessage({ some: 'shape' })).toBe('[object Object]');
  });
});

describe('applicationErrorMessageOrFallback', () => {
  it('returns the Error message when the error is a real Error instance', () => {
    expect(applicationErrorMessageOrFallback(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('returns the string as-is when the error is a plain string', () => {
    expect(applicationErrorMessageOrFallback('raw string error', 'fallback')).toBe('raw string error');
  });

  it('falls back to the friendly message for a plain-object rejection instead of "[object Object]"', () => {
    expect(applicationErrorMessageOrFallback({ some: 'shape' }, 'Failed to delete the message, please try again.')).toBe(
      'Failed to delete the message, please try again.',
    );
  });

  it('falls back for undefined/null/number rejections too', () => {
    expect(applicationErrorMessageOrFallback(undefined, 'fallback')).toBe('fallback');
    expect(applicationErrorMessageOrFallback(null, 'fallback')).toBe('fallback');
    expect(applicationErrorMessageOrFallback(404, 'fallback')).toBe('fallback');
  });

  it('falls back when the Error message itself is empty', () => {
    expect(applicationErrorMessageOrFallback(new Error(''), 'fallback')).toBe('fallback');
  });

  it('falls back when the string error itself is empty', () => {
    expect(applicationErrorMessageOrFallback('', 'fallback')).toBe('fallback');
  });
});
