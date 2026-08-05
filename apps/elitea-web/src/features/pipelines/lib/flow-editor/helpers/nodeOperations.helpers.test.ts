import { describe, expect, it, vi } from 'vitest';

import {
  addTargetToArray,
  clearFieldIfMatchesNodeId,
  findYamlNodeById,
  findYamlNodeByIdWithSuffix,
  generateEndEdgeToRemove,
  generateNewNodeIdWithSuffix,
  generateTimestampedNodeId,
  getOwnerNodeId,
  removeNodeIdFromArray,
} from './nodeOperations.helpers';

describe('getOwnerNodeId', () => {
  it('strips the suffix from a synthetic node id', () => {
    expect(getOwnerNodeId('Agent 1~~~ConditionNode', '~~~ConditionNode')).toBe('Agent 1');
  });

  it('is a no-op when the suffix is absent', () => {
    expect(getOwnerNodeId('Agent 1', '~~~ConditionNode')).toBe('Agent 1');
  });
});

describe('generateNewNodeIdWithSuffix', () => {
  it('appends the suffix', () => {
    expect(generateNewNodeIdWithSuffix('Agent 1', '~~~DecisionNode')).toBe('Agent 1~~~DecisionNode');
  });
});

describe('generateTimestampedNodeId', () => {
  it('embeds the current time between prefix and suffix', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000);
    expect(generateTimestampedNodeId('Condition', '~~~ConditionNode')).toBe('Condition1700000000000~~~ConditionNode');
    vi.useRealTimers();
  });
});

describe('generateEndEdgeToRemove', () => {
  it('builds the synthetic to-End edge id', () => {
    expect(generateEndEdgeToRemove('Agent 1')).toBe('xy-edge__Agent 1---EliteAPipelineEnd');
  });
});

describe('removeNodeIdFromArray', () => {
  it('filters out the given id', () => {
    expect(removeNodeIdFromArray(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('passes through undefined', () => {
    expect(removeNodeIdFromArray(undefined, 'b')).toBeUndefined();
  });
});

describe('addTargetToArray', () => {
  it('appends when absent', () => {
    expect(addTargetToArray(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('is a no-op (dedup) when already present', () => {
    expect(addTargetToArray(['a', 'b'], 'b')).toEqual(['a', 'b']);
  });

  it('starts a new array when given undefined', () => {
    expect(addTargetToArray(undefined, 'a')).toEqual(['a']);
  });
});

describe('clearFieldIfMatchesNodeId', () => {
  it('clears the field when it equals the deleted node id', () => {
    expect(clearFieldIfMatchesNodeId('Agent 1', 'Agent 1')).toBe('');
  });

  it('leaves the field untouched otherwise', () => {
    expect(clearFieldIfMatchesNodeId('Agent 2', 'Agent 1')).toBe('Agent 2');
  });
});

describe('findYamlNodeById', () => {
  const doc = { nodes: [{ id: 'a' }, { id: 'b' }] };

  it('finds by id', () => {
    expect(findYamlNodeById(doc, 'b')).toEqual({ id: 'b' });
  });

  it('returns undefined when missing', () => {
    expect(findYamlNodeById(doc, 'z')).toBeUndefined();
  });
});

describe('findYamlNodeByIdWithSuffix', () => {
  const doc = { nodes: [{ id: 'Agent 1' }] };

  it('strips the suffix before looking up', () => {
    expect(findYamlNodeByIdWithSuffix(doc, 'Agent 1~~~ConditionNode', '~~~ConditionNode')).toEqual({
      id: 'Agent 1',
    });
  });
});
