import { describe, expect, it } from 'vitest';

import { ValidationErrors } from './validation.constants';

describe('ValidationErrors', () => {
  it('has a non-empty message for every declared key', () => {
    for (const message of Object.values(ValidationErrors)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it('VariableNameInvalid mentions the allowed character rule', () => {
    expect(ValidationErrors.VariableNameInvalid).toMatch(/letter/);
  });
});
