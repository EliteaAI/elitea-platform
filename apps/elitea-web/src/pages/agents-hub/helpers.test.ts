import { describe, expect, it } from 'vitest';

import { OTHER_CATEGORY, TRENDING_CATEGORY, MY_LIKED_CATEGORY } from './constants';
import { buildAllCategories, calculateNewLikesCount, filterApplicationsByQuery, getCategoryForApplication } from './helpers';
import type { ApplicationData } from './types';

function makeApp(overrides: Partial<ApplicationData> = {}): ApplicationData {
  return {
    project_id: '1',
    id: 'app-1',
    name: 'Research Agent',
    description: '',
    version_id: 'v-1',
    version_name: 'v1',
    agent_type: 'agent',
    meta: null,
    ...overrides,
  };
}

describe('buildAllCategories', () => {
  it('puts Trending/My Liked first, sorts the rest, and moves Other to the end', () => {
    expect(buildAllCategories(['Zeta', 'Alpha', OTHER_CATEGORY])).toEqual([
      TRENDING_CATEGORY,
      MY_LIKED_CATEGORY,
      'Alpha',
      'Zeta',
      OTHER_CATEGORY,
    ]);
  });
});

describe('getCategoryForApplication (adversarial-review fix, cluster A13-agents-hub, finding 4)', () => {
  it('reads the category from meta.category — the field the real bulk-list endpoint actually populates', () => {
    const app = makeApp({ meta: { category: 'Productivity' } });
    expect(getCategoryForApplication(app)).toBe('Productivity');
  });

  it('falls back to a flat category field when meta has none (back-compat / test fixtures)', () => {
    const app = makeApp({ meta: null, category: 'Legacy Flat Category' });
    expect(getCategoryForApplication(app)).toBe('Legacy Flat Category');
  });

  it('falls back to Other when neither meta.category nor a flat category is set', () => {
    const app = makeApp({ meta: null });
    expect(getCategoryForApplication(app)).toBe(OTHER_CATEGORY);
  });

  it('falls back to Other when meta.category is an empty string', () => {
    const app = makeApp({ meta: { category: '' } });
    expect(getCategoryForApplication(app)).toBe(OTHER_CATEGORY);
  });
});

describe('filterApplicationsByQuery', () => {
  const apps = [makeApp({ id: '1', name: 'Research Agent' }), makeApp({ id: '2', name: 'Support Bot' })];

  it('returns every app for a blank query', () => {
    expect(filterApplicationsByQuery(apps, '  ')).toEqual(apps);
  });

  it('matches case-insensitively on a substring of the name', () => {
    expect(filterApplicationsByQuery(apps, 'research')).toEqual([apps[0]]);
    expect(filterApplicationsByQuery(apps, 'BOT')).toEqual([apps[1]]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterApplicationsByQuery(apps, 'nonexistent')).toEqual([]);
  });
});

describe('calculateNewLikesCount', () => {
  it('trusts a positive server-reported count', () => {
    expect(calculateNewLikesCount(5, true, 0)).toBe(5);
  });

  it('optimistically increments when liked and the server count is not yet known', () => {
    expect(calculateNewLikesCount(0, true, 3)).toBe(4);
  });

  it('optimistically decrements (clamped at 0) when unliked and the server count is not yet known', () => {
    expect(calculateNewLikesCount(0, false, 0)).toBe(0);
  });
});
