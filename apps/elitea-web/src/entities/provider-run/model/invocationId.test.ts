import { describe, expect, it } from 'vitest';
import { invocationIdFrom } from './invocationId';

describe('invocationIdFrom', () => {
  it('returns the id of an accepted invoke', () => {
    expect(invocationIdFrom({ invocation_id: 'invocation_1', status: 'Started' }, 'no id')).toBe('invocation_1');
  });

  it.each([undefined, null, {}, { invocation_id: '' }, { invocation_id: 7 }, 'invocation_1'])(
    'refuses %o with the caller’s words',
    (body) => {
      expect(() => invocationIdFrom(body, 'The provider returned no invocation to follow.')).toThrow(
        'The provider returned no invocation to follow.',
      );
    },
  );
});
