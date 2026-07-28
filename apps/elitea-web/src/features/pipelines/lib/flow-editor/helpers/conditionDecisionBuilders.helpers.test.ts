import { describe, expect, it } from 'vitest';

import { buildNewCondition, buildNewDecision } from './conditionDecisionBuilders.helpers';

describe('buildNewCondition', () => {
  it('appends the target to conditional_outputs when connected from that handle', () => {
    const yamlNode = { condition: { conditional_outputs: ['A'], default_output: 'X' } };
    const result = buildNewCondition(yamlNode, {
      source: 'src',
      target: 'B',
      sourceHandle: 'conditional_outputs',
    });
    expect(result).toEqual({ conditional_outputs: ['A', 'B'], default_output: 'X' });
  });

  it('dedups when the target is already in conditional_outputs', () => {
    const yamlNode = { condition: { conditional_outputs: ['A'] } };
    const result = buildNewCondition(yamlNode, { source: 'src', target: 'A', sourceHandle: 'conditional_outputs' });
    expect(result['conditional_outputs']).toEqual(['A']);
  });

  it('sets default_output when connected from any other handle', () => {
    const yamlNode = { condition: { conditional_outputs: ['A'] } };
    const result = buildNewCondition(yamlNode, { source: 'src', target: 'C', sourceHandle: 'default_output' });
    expect(result).toEqual({ conditional_outputs: ['A'], default_output: 'C' });
  });

  it('starts from an empty structure when the node has no condition yet', () => {
    const result = buildNewCondition({}, { source: 'src', target: 'B', sourceHandle: 'conditional_outputs' });
    expect(result).toEqual({ conditional_outputs: ['B'] });
  });

  it('tolerates a non-object yamlNode (unknown-typed real call site)', () => {
    const result = buildNewCondition(undefined, { source: 'src', target: 'B', sourceHandle: 'default_output' });
    expect(result).toEqual({ default_output: 'B' });
  });
});

describe('buildNewDecision', () => {
  it('appends the target to nodes[] when connected from the nodes handle', () => {
    const yamlNode = { decision: { nodes: ['A'] } };
    const result = buildNewDecision(yamlNode, { source: 'src', target: 'B', sourceHandle: 'nodes' });
    expect(result).toEqual({ nodes: ['A', 'B'] });
  });

  it('sets default_output on any other handle', () => {
    const yamlNode = { decision: { nodes: ['A'] } };
    const result = buildNewDecision(yamlNode, { source: 'src', target: 'C', sourceHandle: 'default_output' });
    expect(result).toEqual({ nodes: ['A'], default_output: 'C' });
  });
});
