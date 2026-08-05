import { describe, expect, it } from 'vitest';

import {
  isSkillValid,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_INSTRUCTIONS_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  validateSkill,
} from './skillValidation';

describe('skill validation', () => {
  it('accepts a complete skill and ignores surrounding whitespace', () => {
    const input = { name: ' Name ', description: ' Description ', instructions: ' Do it ', tags: [] };
    expect(validateSkill(input)).toEqual({});
    expect(isSkillValid(input)).toBe(true);
  });

  it('requires all three text fields', () => {
    const errors = validateSkill({ name: ' ', description: '', instructions: '\n', tags: [] });
    expect(errors).toEqual({
      name: 'Name is required.',
      description: 'Description is required.',
      instructions: 'Instructions are required.',
    });
    expect(isSkillValid({ name: '', description: '', instructions: '', tags: [] })).toBe(false);
  });

  it('enforces the published maximum lengths', () => {
    const errors = validateSkill({
      name: 'n'.repeat(SKILL_NAME_MAX_LENGTH + 1),
      description: 'd'.repeat(SKILL_DESCRIPTION_MAX_LENGTH + 1),
      instructions: 'i'.repeat(SKILL_INSTRUCTIONS_MAX_LENGTH + 1),
      tags: [],
    });
    expect(errors.name).toContain(String(SKILL_NAME_MAX_LENGTH));
    expect(errors.description).toContain(String(SKILL_DESCRIPTION_MAX_LENGTH));
    expect(errors.instructions).toContain(String(SKILL_INSTRUCTIONS_MAX_LENGTH));
  });
});
