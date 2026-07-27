import { describe, expect, it } from 'vitest';

import { EliteaApiError } from '@/shared/api/generated/mutator';

import { notificationErrorMessage } from './errorMessage';

describe('notificationErrorMessage', () => {
  it('kind: http — delegates to buildErrorMessage with {status, data}', () => {
    const error = new EliteaApiError({ kind: 'http', status: 404, url: '/x', body: undefined });
    expect(notificationErrorMessage(error)).toBe('The requested resource was not found!');
  });

  it('kind: http — surfaces data.message when present', () => {
    const error = new EliteaApiError({ kind: 'http', status: 400, url: '/x', body: { message: 'bad input' } });
    expect(notificationErrorMessage(error)).toBe('bad input');
  });

  it('kind: http — stringifies a non-string buildErrorMessage result', () => {
    const error = new EliteaApiError({ kind: 'http', status: 400, url: '/x', body: { error: { nested: true } } });
    expect(notificationErrorMessage(error)).toBe(JSON.stringify({ nested: true }));
  });

  it('kind: auth — a short, honest, non-baseline message', () => {
    const error = new EliteaApiError({ kind: 'auth', status: 401, url: '/x' });
    expect(notificationErrorMessage(error)).toBe('Authentication is required to complete this action.');
  });

  it('kind: network — passes the failure message through', () => {
    const error = new EliteaApiError({ kind: 'network', url: '/x', message: 'boom', cause: new Error('boom') });
    expect(notificationErrorMessage(error)).toBe('boom');
  });

  it('kind: aborted — a short cancellation message', () => {
    const error = new EliteaApiError({ kind: 'aborted', url: '/x' });
    expect(notificationErrorMessage(error)).toBe('The request was cancelled.');
  });

  it('falls back to Error.message for a plain Error', () => {
    expect(notificationErrorMessage(new Error('plain'))).toBe('plain');
  });

  it('falls back to String() for a non-Error, non-EliteaApiError value', () => {
    expect(notificationErrorMessage('oops')).toBe('oops');
  });
});
