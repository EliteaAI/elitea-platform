import { describe, expect, it } from 'vitest';

import { checkFloors, subjectPath } from './gate-floor.mjs';

describe('subjectPath', () => {
  it('shortens a path inside the tree to its relative form', () => {
    expect(subjectPath('/app', '/app/src/shared/api/endpoints.manifest.json'))
      .toBe('src/shared/api/endpoints.manifest.json');
  });

  it('keeps the absolute path for a fixture outside the tree', () => {
    expect(subjectPath('/app', '/tmp/fixture.json')).toBe('/tmp/fixture.json');
  });
});

/**
 * Unit proof for the shared floor rule (issue #528).
 *
 * The rule is what turns "the gate found nothing" into "the gate looked at
 * nothing, and that is a failure". Each case below pins one half of it.
 */
describe('checkFloors', () => {
  it('passes when every count sits on or over its floor, and states each count', () => {
    const result = checkFloors('check-example', [
      { subject: 'routes', observed: 79, floor: 60 },
      { subject: 'baselines', observed: 24, floor: 24 },
    ]);

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.lines).toEqual([
      'check-example: measured 79 routes (floor 60).',
      'check-example: measured 24 baselines (floor 24).',
    ]);
  });

  it('fails when a count is under its floor, and names the short subject', () => {
    const result = checkFloors('check-example', [
      { subject: 'routes', observed: 0, floor: 60 },
      { subject: 'baselines', observed: 38, floor: 24 },
    ]);

    expect(result.ok).toBe(false);
    // Both counts still print. The reader must see the healthy one too.
    expect(result.lines).toHaveLength(2);
    expect(result.error).toContain('the subject set is empty or too small');
    expect(result.error).toContain('0 routes — floor 60');
    expect(result.error).not.toContain('38 baselines — floor 24');
  });

  it('reports every short subject, not only the first', () => {
    const result = checkFloors('check-example', [
      { subject: 'routes', observed: 0, floor: 60 },
      { subject: 'baselines', observed: 1, floor: 24 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('0 routes — floor 60');
    expect(result.error).toContain('1 baselines — floor 24');
  });

  it('fails on an empty check list — a gate that states no floor proves nothing', () => {
    const result = checkFloors('check-example', []);

    expect(result.ok).toBe(false);
    expect(result.lines).toEqual([]);
    expect(result.error).toContain('states no floor');
  });

  it('fails when the check list is not a list at all', () => {
    const result = checkFloors('check-example', undefined);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('states no floor');
  });
});
