import { describe, expect, it } from 'vitest';

import {
  applicationDisplayName,
  isForkedApplication,
  isOwnedApplication,
  isPipelineApplication,
  sortApplicationsByRecency,
} from './selectors';
import type { Application } from './types';

const ZERO_SENTINEL = '0001-01-01T00:00:00Z';

const application = (overrides: Partial<Application> = {}): Application => ({
  id: '1',
  name: 'Agent One',
  ownerId: 'owner-1',
  isForked: false,
  meta: null,
  hasInterrupt: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  ...overrides,
});

describe('sortApplicationsByRecency', () => {
  it('orders by updatedAt descending', () => {
    const older = application({ id: 'a', updatedAt: '2026-01-01T00:00:00Z' });
    const newer = application({ id: 'b', updatedAt: '2026-01-05T00:00:00Z' });
    expect(sortApplicationsByRecency([older, newer]).map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('falls back to createdAt when updatedAt carries the List-endpoint zero sentinel', () => {
    const stale = application({ id: 'a', createdAt: '2020-01-01T00:00:00Z', updatedAt: ZERO_SENTINEL });
    const recent = application({ id: 'b', createdAt: '2026-01-01T00:00:00Z', updatedAt: ZERO_SENTINEL });
    expect(sortApplicationsByRecency([stale, recent]).map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the input array', () => {
    const list = [application({ id: 'a' }), application({ id: 'b' })];
    const copy = [...list];
    sortApplicationsByRecency(list);
    expect(list).toEqual(copy);
  });
});

describe('isForkedApplication', () => {
  it('reflects the isForked field', () => {
    expect(isForkedApplication(application({ isForked: true }))).toBe(true);
    expect(isForkedApplication(application({ isForked: false }))).toBe(false);
  });
});

describe('isPipelineApplication', () => {
  it('is true only for agentType "pipeline"', () => {
    expect(isPipelineApplication(application({ agentType: 'pipeline' }))).toBe(true);
    expect(isPipelineApplication(application({ agentType: 'openai' }))).toBe(false);
  });

  it('is false when agentType is absent', () => {
    expect(isPipelineApplication(application())).toBe(false);
  });
});

describe('isOwnedApplication', () => {
  it('is true when ownerId matches the given user', () => {
    expect(isOwnedApplication(application({ ownerId: 'u1' }), 'u1')).toBe(true);
  });

  it('is false when ownerId differs', () => {
    expect(isOwnedApplication(application({ ownerId: 'u1' }), 'u2')).toBe(false);
  });
});

describe('applicationDisplayName', () => {
  it('returns the name when non-blank', () => {
    expect(applicationDisplayName(application({ name: 'My Agent' }))).toBe('My Agent');
  });

  it('falls back to "Untitled" for a blank name', () => {
    expect(applicationDisplayName(application({ name: '   ' }))).toBe('Untitled');
  });
});
