import { describe, expect, it } from 'vitest';

import { filterSkillsByQuery, skillDescription, sortSkillsByName } from './selectors';
import type { Skill } from './types';

const skill = (id: string, name: string, description?: string): Skill => ({
  id,
  projectId: 'p1',
  name,
  ...(description !== undefined ? { description } : {}),
  type: 'skill',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '0001-01-01T00:00:00Z',
});

describe('sortSkillsByName', () => {
  it('sorts case-insensitively', () => {
    const skills = [skill('1', 'zeta'), skill('2', 'Alpha')];
    expect(sortSkillsByName(skills).map((s) => s.id)).toEqual(['2', '1']);
  });

  it('does not mutate the input', () => {
    const skills = [skill('1', 'b'), skill('2', 'a')];
    const copy = [...skills];
    sortSkillsByName(skills);
    expect(skills).toEqual(copy);
  });
});

describe('filterSkillsByQuery', () => {
  const skills = [skill('1', 'Summarize'), skill('2', 'summary-lite'), skill('3', 'Translate')];

  it('matches case-insensitive substrings', () => {
    expect(filterSkillsByQuery(skills, 'summ').map((s) => s.id)).toEqual(['1', '2']);
  });

  it('returns every skill for a blank query', () => {
    expect(filterSkillsByQuery(skills, '')).toEqual(skills);
  });
});

describe('skillDescription', () => {
  it('returns the description when present', () => {
    expect(skillDescription(skill('1', 'a', 'does things'))).toBe('does things');
  });

  it('returns an empty string when absent', () => {
    expect(skillDescription(skill('1', 'a'))).toBe('');
  });
});
