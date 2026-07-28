import { describe, expect, it } from 'vitest';

import { pipelineErrorMessage } from './pipelineErrorMessage';

describe('pipelineErrorMessage', () => {
  it('returns an Error instance message', () => {
    expect(pipelineErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error value', () => {
    expect(pipelineErrorMessage('plain string')).toBe('plain string');
    expect(pipelineErrorMessage(404)).toBe('404');
    expect(pipelineErrorMessage(null)).toBe('null');
  });
});
