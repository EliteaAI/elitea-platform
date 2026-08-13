import { describe, expect, it } from 'vitest';

import { normalizeAgentPath, normalizeExecutionHierarchy } from './executionHierarchy';

describe('normalizeAgentPath', () => {
  it('drops tiers that identify nothing', () => {
    expect(
      normalizeAgentPath([{ name: 'planner', call_id: 'c1' }, { name: '   ', call_id: '' }, null, 'nope']),
    ).toEqual([{ name: 'planner', call_id: 'c1' }]);
  });

  it('keeps a positive integer ordinal and drops anything else', () => {
    // The ordinal disambiguates concurrent siblings; a zero or fractional value
    // would make two different sub-agents collapse onto one chip.
    expect(normalizeAgentPath([{ name: 'a', call_id: 'c', sibling_ordinal: 2 }])[0]?.sibling_ordinal).toBe(2);
    expect(normalizeAgentPath([{ name: 'a', call_id: 'c', sibling_ordinal: 0 }])[0]?.sibling_ordinal).toBeUndefined();
    expect(normalizeAgentPath([{ name: 'a', call_id: 'c', sibling_ordinal: 1.5 }])[0]?.sibling_ordinal).toBeUndefined();
  });

  it('returns an empty path for a non-array', () => {
    expect(normalizeAgentPath(undefined)).toEqual([]);
    expect(normalizeAgentPath({ name: 'x' })).toEqual([]);
  });
});

describe('normalizeExecutionHierarchy', () => {
  it('prefers the DEEPEST path, not the first source', () => {
    // A task overlay and richer producer metadata can both be passed. Letting
    // argument order win would make a persisted render drop a tier the live
    // stream had kept — the reason the baseline scores sources.
    const shallow = { parent_agent_path: [{ name: 'root', call_id: 'r' }] };
    const deep = {
      parent_agent_path: [
        { name: 'root', call_id: 'r' },
        { name: 'child', call_id: 'c', sibling_ordinal: 1 },
      ],
    };

    expect(normalizeExecutionHierarchy(shallow, deep).parent_agent_path).toHaveLength(2);
    expect(normalizeExecutionHierarchy(deep, shallow).parent_agent_path).toHaveLength(2);
  });

  it('resolves scalars first-wins so a specific override beats general metadata', () => {
    const hierarchy = normalizeExecutionHierarchy(
      { parent_agent_name: 'specific' },
      { parent_agent_name: 'general', parent_agent_call_id: 'call-2' },
    );

    expect(hierarchy.parent_agent_name).toBe('specific');
    expect(hierarchy.parent_agent_call_id).toBe('call-2');
  });

  it('falls back to the last path tier when no source names the parent', () => {
    const hierarchy = normalizeExecutionHierarchy({
      parent_agent_path: [
        { name: 'root', call_id: 'r' },
        { name: 'leaf', call_id: 'l' },
      ],
    });

    expect(hierarchy.parent_agent_name).toBe('leaf');
    expect(hierarchy.parent_agent_call_id).toBe('l');
  });

  it('ignores non-object sources instead of throwing', () => {
    expect(normalizeExecutionHierarchy(null, undefined, 'x', 42)).toEqual({
      parent_agent_name: '',
      parent_agent_call_id: '',
      parent_agent_path: [],
    });
  });
});
