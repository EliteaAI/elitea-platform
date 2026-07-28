import { describe, expect, it } from 'vitest';

import {
  clearYamlNodeCondition,
  clearYamlNodeDecision,
  removeInterruptReferences,
  updateYamlNodeCondition,
  updateYamlNodeDecision,
  updateYamlNodeTransition,
} from './yamlUpdate.helpers';

describe('updateYamlNodeCondition', () => {
  it('merges into an existing object condition', () => {
    const node = { id: 'A', condition: { default_output: 'X' } };
    expect(updateYamlNodeCondition(node, { conditional_outputs: ['B'] })).toEqual({
      id: 'A',
      condition: { default_output: 'X', conditional_outputs: ['B'] },
    });
  });

  it('sets the condition when the node has none yet', () => {
    const node = { id: 'A' };
    expect(updateYamlNodeCondition(node, { default_output: 'X' })).toEqual({
      id: 'A',
      condition: { default_output: 'X' },
    });
  });
});

describe('updateYamlNodeDecision', () => {
  it('is a no-op when the node has no decision at all (baseline guard)', () => {
    const node = { id: 'A' };
    expect(updateYamlNodeDecision(node, { default_output: 'X' })).toBe(node);
  });

  it('merges into an existing decision', () => {
    const node = { id: 'A', decision: { nodes: ['B'] } };
    expect(updateYamlNodeDecision(node, { default_output: 'X' })).toEqual({
      id: 'A',
      decision: { nodes: ['B'], default_output: 'X' },
    });
  });
});

describe('clearYamlNodeCondition / clearYamlNodeDecision', () => {
  it('sets the property to undefined', () => {
    expect(clearYamlNodeCondition({ id: 'A', condition: { default_output: 'X' } })).toEqual({
      id: 'A',
      condition: undefined,
    });
    expect(clearYamlNodeDecision({ id: 'A', decision: { nodes: ['B'] } })).toEqual({ id: 'A', decision: undefined });
  });
});

describe('updateYamlNodeTransition', () => {
  it('sets transition, preserving other fields', () => {
    expect(updateYamlNodeTransition({ id: 'A', tool: 'x' }, 'END')).toEqual({ id: 'A', tool: 'x', transition: 'END' });
  });
});

describe('removeInterruptReferences', () => {
  it('removes the node id from both interrupt arrays when both are present', () => {
    const doc = { interrupt_before: ['A', 'B'], interrupt_after: ['B', 'C'] };
    expect(removeInterruptReferences(doc, 'B')).toEqual({ interrupt_before: ['A'], interrupt_after: ['C'] });
  });

  it('leaves interrupt_before untouched when the document has none', () => {
    const doc = { interrupt_after: ['A', 'B'] };
    expect(removeInterruptReferences(doc, 'B')).toEqual({ interrupt_after: ['A'] });
  });

  it('is a no-op copy when neither array is present', () => {
    expect(removeInterruptReferences({}, 'B')).toEqual({});
  });
});
