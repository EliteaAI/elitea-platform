import { describe, expect, it } from 'vitest';

import { normalisePipelineTrigger } from './normalise';
import type { PipelineTriggerWire } from '../model/types';

const wire: PipelineTriggerWire = {
  version_id: 'v1',
  enabled: true,
  schedule: { cron: '0 0 * * *' },
  type: 'cron',
};

describe('normalisePipelineTrigger', () => {
  it('maps version_id to versionId and passes the rest through', () => {
    expect(normalisePipelineTrigger(wire)).toEqual({
      versionId: 'v1',
      enabled: true,
      schedule: { cron: '0 0 * * *' },
      type: 'cron',
    });
  });

  it('preserves a false enabled rather than defaulting it', () => {
    expect(normalisePipelineTrigger({ ...wire, enabled: false }).enabled).toBe(false);
  });

  it('preserves an explicit null type as null, not "Manual"-coerced or dropped', () => {
    const result = normalisePipelineTrigger({ ...wire, type: null });
    expect(result.type).toBeNull();
    expect(Object.keys(result)).toContain('type');
  });

  it('omits enabled/schedule/type entirely when the wire truly did not send them, rather than setting undefined', () => {
    const result = normalisePipelineTrigger({ version_id: 'v1' });
    expect(result).toEqual({ versionId: 'v1' });
    expect(Object.keys(result)).toEqual(['versionId']);
  });

  it('passes an arbitrary schedule jsonb value through unchanged (the Go side never types it)', () => {
    const schedule = { minute: '*/5', timezone: 'UTC' };
    expect(normalisePipelineTrigger({ ...wire, schedule }).schedule).toEqual(schedule);
  });
});
