import { describe, expect, it } from 'vitest';

import type { FlowEdge } from '../reactFlowTypes';
import { checkShowInterruptLabel, createNewEdge, updateNodeIdInEdge } from './edgeOperations.helpers';

describe('updateNodeIdInEdge', () => {
  const renameMap = { 'old-id': 'new-id' };

  it('renames a matching source', () => {
    const edge: FlowEdge = { id: 'e1', source: 'old-id', target: 'end' };
    expect(updateNodeIdInEdge(edge, renameMap)).toEqual({ ...edge, source: 'new-id' });
  });

  it('renames a matching target', () => {
    const edge: FlowEdge = { id: 'e1', source: 'start', target: 'old-id' };
    expect(updateNodeIdInEdge(edge, renameMap)).toEqual({ ...edge, target: 'new-id' });
  });

  it('leaves an unrelated edge untouched', () => {
    const edge: FlowEdge = { id: 'e1', source: 'start', target: 'end' };
    expect(updateNodeIdInEdge(edge, renameMap)).toBe(edge);
  });

  it('is a no-op for an empty rename map', () => {
    const edge: FlowEdge = { id: 'e1', source: 'old-id', target: 'end' };
    expect(updateNodeIdInEdge(edge, {})).toBe(edge);
  });
});

describe('createNewEdge', () => {
  it('builds an un-ided custom edge with no data when the connection does not cross an interrupt', () => {
    const connection = { source: 's', target: 't', sourceHandle: null, targetHandle: null };
    expect(createNewEdge(connection, false)).toEqual({ ...connection, type: 'custom', data: undefined });
  });

  it('attaches an Interrupt label when showInterruptLabel is true', () => {
    const connection = { source: 's', target: 't', sourceHandle: null, targetHandle: null };
    expect(createNewEdge(connection, true)).toEqual({ ...connection, type: 'custom', data: { label: 'Interrupt' } });
  });

  it('preserves a pre-assigned id (the HITL deterministic-id path)', () => {
    const connection = { id: 'xy-edge__sAction---t', source: 's', target: 't', sourceHandle: null, targetHandle: null };
    expect(createNewEdge(connection, false).id).toBe('xy-edge__sAction---t');
  });
});

describe('checkShowInterruptLabel', () => {
  const connection = { source: 'a', target: 'b' };

  it('is true when the source is in interrupt_after', () => {
    expect(checkShowInterruptLabel({ interrupt_after: ['a'], connection })).toBe(true);
  });

  it('is true when the target is in interrupt_before', () => {
    expect(checkShowInterruptLabel({ interrupt_before: ['b'], connection })).toBe(true);
  });

  it('is false when neither list mentions the connection', () => {
    expect(checkShowInterruptLabel({ interrupt_after: ['x'], interrupt_before: ['y'], connection })).toBe(false);
  });

  it('is false when both lists are undefined', () => {
    expect(checkShowInterruptLabel({ connection })).toBe(false);
  });
});
