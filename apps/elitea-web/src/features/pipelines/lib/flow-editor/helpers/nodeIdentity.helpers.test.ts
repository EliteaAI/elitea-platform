import { describe, expect, it } from 'vitest';

import { generateNodeIdByType, getInitialNodeId, isCompilerLegalNodeId } from './nodeIdentity.helpers';
import { PipelineNodeTypes } from '../constants/flowEditor.constants';
import { CompilerAdmittedNodeTypes, MAX_NODE_ID_BYTES } from '../constants/runtimeContract.constants';

/**
 * The measured defect: `getInitialNodeId` minted `"Agent 1"` — a SPACE — and
 * `valid_graph_id`
 * (`services/elitea-worker-rust/src/agents/graph/yaml.rs:362`) admits ASCII
 * alphanumerics plus `_ - . :` and nothing else. Because the editor also
 * assigns `entry_point` to the first node added, the very first node a user
 * added produced a document the compiler refuses
 * (`graph.pipeline.invalid_configuration`). The SDK worker hid this by
 * rewriting ids through `clean_string`; the Rust runtime never rewrites.
 */
describe('isCompilerLegalNodeId', () => {
  it('accepts exactly the character set valid_graph_id accepts', () => {
    expect(isCompilerLegalNodeId('Agent_1')).toBe(true);
    expect(isCompilerLegalNodeId('a-b.c:d')).toBe(true);
    expect(isCompilerLegalNodeId('END')).toBe(true);
    expect(isCompilerLegalNodeId('0')).toBe(true);
  });

  it('refuses a space — the exact shape the editor used to mint', () => {
    expect(isCompilerLegalNodeId('Agent 1')).toBe(false);
    expect(isCompilerLegalNodeId('My Agent')).toBe(false);
    expect(isCompilerLegalNodeId('trailing ')).toBe(false);
  });

  it('refuses the empty id, non-ASCII, and anything outside the set', () => {
    expect(isCompilerLegalNodeId('')).toBe(false);
    expect(isCompilerLegalNodeId('Agénte')).toBe(false);
    expect(isCompilerLegalNodeId('Agent/1')).toBe(false);
    expect(isCompilerLegalNodeId('Agent#1')).toBe(false);
    expect(isCompilerLegalNodeId('Condition1~~~ConditionNode')).toBe(false);
  });

  it('enforces the runtime byte ceiling (yaml.rs:10)', () => {
    expect(isCompilerLegalNodeId('a'.repeat(MAX_NODE_ID_BYTES))).toBe(true);
    expect(isCompilerLegalNodeId('a'.repeat(MAX_NODE_ID_BYTES + 1))).toBe(false);
  });
});

describe('getInitialNodeId mints ids the pipeline compiler admits', () => {
  it.each(CompilerAdmittedNodeTypes)('mints a compiler-legal id for a fresh %s node', type => {
    const id = getInitialNodeId(type, []);
    expect(isCompilerLegalNodeId(id)).toBe(true);
    expect(id).not.toContain(' ');
  });

  it('separates the type name from the ordinal with `_`, not a space', () => {
    expect(getInitialNodeId(PipelineNodeTypes.Agent, [])).toBe('Agent_1');
    expect(getInitialNodeId(PipelineNodeTypes.StateModifier, [])).toBe('StateModifier_1');
    expect(getInitialNodeId(PipelineNodeTypes.Hitl, [])).toBe('HITL_1');
  });

  it('never mints the literal "Agent 1" again, whatever is already on the canvas', () => {
    const nodes = [{ id: 'Agent 1' }, { id: 'Agent_2' }, { id: 'unrelated' }];
    expect(getInitialNodeId(PipelineNodeTypes.Agent, nodes)).toBe('Agent_3');
  });

  it('treats an existing space-separated legacy id as taken, so the two cannot sit side by side', () => {
    // A stored document may still hold `Agent 1` (nothing rewrites it — see
    // getNormalInitialNodeId's own comment). Minting `Agent_1` beside it
    // would give the canvas two near-identical labels.
    expect(getInitialNodeId(PipelineNodeTypes.Agent, [{ id: 'Agent 1' }])).toBe('Agent_2');
  });

  it('falls back to the Custom prefix for an unknown type, still compiler-legal', () => {
    expect(isCompilerLegalNodeId(getInitialNodeId('not_a_real_type', []))).toBe(true);
  });
});

describe('generateNodeIdByType', () => {
  it.each(CompilerAdmittedNodeTypes)('gives a fresh %s node a compiler-legal id and its seeded data', type => {
    const node = generateNodeIdByType(type, []);
    expect(isCompilerLegalNodeId(node.id)).toBe(true);
    expect(node.type).toBe(type);
  });

  it('numbers a second node of the same type without colliding', () => {
    const first = generateNodeIdByType(PipelineNodeTypes.Router, []);
    const second = generateNodeIdByType(PipelineNodeTypes.Router, [first]);
    expect(second.id).not.toBe(first.id);
    expect(second.id).toBe('Router_2');
  });
});
