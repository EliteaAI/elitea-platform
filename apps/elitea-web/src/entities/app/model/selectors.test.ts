import { describe, expect, it } from 'vitest';

import { calculateNewLikesCount, filterAppsByQuery } from './selectors';
import type { App } from './types';

const app = (overrides: Partial<App> = {}): App => ({
  projectId: '0',
  id: '1',
  name: 'My App',
  description: 'desc',
  versionId: 'v1',
  versionName: 'base',
  agentType: 'openai',
  meta: null,
  ...overrides,
});

describe('calculateNewLikesCount', () => {
  it('trusts a positive server count regardless of like state', () => {
    expect(calculateNewLikesCount(5, true, 0)).toBe(5);
    expect(calculateNewLikesCount(5, false, 99)).toBe(5);
  });

  it('optimistically increments when liked and server count is not positive', () => {
    expect(calculateNewLikesCount(0, true, 3)).toBe(4);
  });

  it('optimistically decrements, clamped at 0, when unliked and server count is not positive', () => {
    expect(calculateNewLikesCount(0, false, 1)).toBe(0);
    expect(calculateNewLikesCount(0, false, 0)).toBe(0);
  });
});

describe('filterAppsByQuery', () => {
  const apps = [app({ id: '1', name: 'Support Bot' }), app({ id: '2', name: 'Sales Bot' }), app({ id: '3', name: 'Docs' })];

  it('matches case-insensitive substrings', () => {
    expect(filterAppsByQuery(apps, 'bot').map((a) => a.id)).toEqual(['1', '2']);
  });

  it('returns every app for a blank query', () => {
    expect(filterAppsByQuery(apps, '')).toEqual(apps);
  });
});
