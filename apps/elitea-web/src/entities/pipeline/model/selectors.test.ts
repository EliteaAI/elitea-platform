import { describe, expect, it } from 'vitest';

import { hasSchedule, isTriggerEnabled, triggerTypeLabel } from './selectors';
import type { Pipeline, PipelineTrigger } from './types';

const pipeline = (trigger?: PipelineTrigger): Pipeline => ({
  id: '1',
  name: 'My Pipeline',
  agentType: 'pipeline',
  ownerId: 'owner-1',
  isForked: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...(trigger !== undefined ? { trigger } : {}),
});

describe('isTriggerEnabled', () => {
  it('is true only when enabled is exactly true', () => {
    expect(isTriggerEnabled({ versionId: '1', enabled: true })).toBe(true);
  });

  it('is false when enabled is null', () => {
    expect(isTriggerEnabled({ versionId: '1', enabled: null })).toBe(false);
  });

  it('is false when enabled is false', () => {
    expect(isTriggerEnabled({ versionId: '1', enabled: false })).toBe(false);
  });

  it('is false when there is no trigger at all', () => {
    expect(isTriggerEnabled(undefined)).toBe(false);
  });
});

describe('triggerTypeLabel', () => {
  it('returns "Manual" when there is no trigger', () => {
    expect(triggerTypeLabel(undefined)).toBe('Manual');
  });

  it('returns "Manual" when type is null', () => {
    expect(triggerTypeLabel({ versionId: '1', type: null })).toBe('Manual');
  });

  it('returns "Manual" when type is blank', () => {
    expect(triggerTypeLabel({ versionId: '1', type: '   ' })).toBe('Manual');
  });

  it('returns the trigger type otherwise', () => {
    expect(triggerTypeLabel({ versionId: '1', type: 'cron' })).toBe('cron');
  });
});

describe('hasSchedule', () => {
  it('is true when a non-null schedule is present', () => {
    expect(hasSchedule(pipeline({ versionId: '1', schedule: '0 * * * *' }))).toBe(true);
  });

  it('is false when the schedule is null', () => {
    expect(hasSchedule(pipeline({ versionId: '1', schedule: null }))).toBe(false);
  });

  it('is false when there is no trigger', () => {
    expect(hasSchedule(pipeline())).toBe(false);
  });
});
