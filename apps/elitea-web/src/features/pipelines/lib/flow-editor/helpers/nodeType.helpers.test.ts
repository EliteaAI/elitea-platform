import { describe, expect, it } from 'vitest';

import {
  cannotConnectToConditionOrDecision,
  isConditionNode,
  isConnectToConditionNode,
  isConnectToDecisionNode,
  isConnectToEndNode,
  isDecisionNode,
  isDefaultOutputHandle,
  isFromConditionNode,
  isFromDecisionNode,
  isFromHitlNode,
  isFromRouterNode,
  isGhostNode,
  isHitlHandle,
  isLegacyDecisionNode,
  isRouterHandle,
} from './nodeType.helpers';

describe('node-type predicates', () => {
  it('isConditionNode / isDecisionNode / isGhostNode check `.type`', () => {
    expect(isConditionNode({ type: 'condition' })).toBe(true);
    expect(isDecisionNode({ type: 'decision' })).toBe(true);
    expect(isGhostNode({ type: 'ghost' })).toBe(true);
    expect(isConditionNode({ type: 'tool' })).toBe(false);
  });

  it('isLegacyDecisionNode requires both decision type AND the legacy id suffix', () => {
    expect(isLegacyDecisionNode({ type: 'decision', id: 'Agent 1~~~DecisionNode' })).toBe(true);
    expect(isLegacyDecisionNode({ type: 'decision', id: 'Decision 1' })).toBe(false);
    expect(isLegacyDecisionNode({ type: 'tool', id: 'x~~~DecisionNode' })).toBe(false);
  });
});

describe('connection-source/target predicates', () => {
  it('isFromConditionNode / isConnectToConditionNode check the suffix on source/target', () => {
    expect(isFromConditionNode({ source: 'A~~~ConditionNode', target: 'B' })).toBe(true);
    expect(isConnectToConditionNode({ source: 'A', target: 'B~~~ConditionNode' })).toBe(true);
    expect(isFromConditionNode({ source: 'A', target: 'B' })).toBe(false);
  });

  it('isFromRouterNode checks the sourceHandle prefix', () => {
    expect(isFromRouterNode({ source: 'A', target: 'B', sourceHandle: 'routerNode_routes' })).toBe(true);
    expect(isFromRouterNode({ source: 'A', target: 'B', sourceHandle: 'other' })).toBe(false);
    expect(isFromRouterNode({ source: 'A', target: 'B' })).toBe(false);
  });

  it('isFromHitlNode delegates to isHitlHandle on sourceHandle', () => {
    expect(isFromHitlNode({ source: 'A', target: 'B', sourceHandle: 'hitlNode_approve' })).toBe(true);
    expect(isFromHitlNode({ source: 'A', target: 'B', sourceHandle: null })).toBe(false);
  });

  it('isConnectToEndNode checks target === END', () => {
    expect(isConnectToEndNode({ source: 'A', target: 'END' })).toBe(true);
    expect(isConnectToEndNode({ source: 'A', target: 'B' })).toBe(false);
  });
});

describe('isFromDecisionNode / isConnectToDecisionNode (legacy suffix OR new-format node type)', () => {
  it('true via the legacy id suffix, no ref needed', () => {
    expect(
      isFromDecisionNode({
        connection: { source: 'A~~~DecisionNode', target: 'B' },
        yamlJsonObjectRef: { current: undefined },
      }),
    ).toBe(true);
  });

  it('true via a new-format Decision-type node looked up by id', () => {
    expect(
      isFromDecisionNode({
        connection: { source: 'DecisionA', target: 'B' },
        yamlJsonObjectRef: { current: { nodes: [{ id: 'DecisionA', type: 'decision' }] } },
      }),
    ).toBe(true);
  });

  it('false when neither condition holds', () => {
    expect(
      isConnectToDecisionNode({
        connection: { source: 'A', target: 'B' },
        yamlJsonObjectRef: { current: { nodes: [{ id: 'B', type: 'tool' }] } },
      }),
    ).toBe(false);
  });
});

describe('cannotConnectToConditionOrDecision', () => {
  it('true when the target is a condition-suffixed node', () => {
    expect(
      cannotConnectToConditionOrDecision({
        connection: { source: 'A', target: 'B~~~ConditionNode' },
        yamlJsonObjectRef: { current: undefined },
      }),
    ).toBe(true);
  });

  it('false for a plain connection', () => {
    expect(
      cannotConnectToConditionOrDecision({
        connection: { source: 'A', target: 'B' },
        yamlJsonObjectRef: { current: { nodes: [{ id: 'B', type: 'tool' }] } },
      }),
    ).toBe(false);
  });
});

describe('handle-type predicates', () => {
  it('isRouterHandle / isDefaultOutputHandle / isHitlHandle', () => {
    expect(isRouterHandle('routerNode_default_output')).toBe(true);
    expect(isDefaultOutputHandle('routerNode_default_output')).toBe(true);
    expect(isDefaultOutputHandle('routerNode_routes')).toBe(false);
    expect(isHitlHandle('hitlNode_edit')).toBe(true);
    expect(isHitlHandle(undefined)).toBe(false);
  });
});
