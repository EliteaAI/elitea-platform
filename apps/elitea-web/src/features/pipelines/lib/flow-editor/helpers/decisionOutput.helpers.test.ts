import { describe, expect, it } from 'vitest';

import { getBorderColorAndTooltip } from './decisionOutput.helpers';
import type { FlowGraphEdge, FlowGraphNode } from './pipelineFlow.types';

const nodes: FlowGraphNode[] = [{ id: 'A', position: { x: 0, y: 0 } }, { id: 'B', position: { x: 0, y: 0 } }];

describe('getBorderColorAndTooltip', () => {
  it('rejected when the target node does not exist at all', () => {
    expect(getBorderColorAndTooltip([], nodes, 'A', 'Z')).toEqual({
      borderColor: 'rejected',
      tooltip: "Corresponding node doesn't exist",
    });
  });

  it('published when an edge from id to target already exists', () => {
    const edges: FlowGraphEdge[] = [{ id: 'e1', source: 'A', target: 'B' }];
    expect(getBorderColorAndTooltip(edges, nodes, 'A', 'B')).toEqual({ borderColor: 'published', tooltip: '' });
  });

  it('onModeration when the target node exists but no edge connects them yet', () => {
    expect(getBorderColorAndTooltip([], nodes, 'A', 'B')).toEqual({
      borderColor: 'onModeration',
      tooltip: 'Not connected to the corresponding node',
    });
  });

  it('target-existence is checked before edge presence (rejected wins even with an unrelated edge present)', () => {
    const edges: FlowGraphEdge[] = [{ id: 'e1', source: 'A', target: 'B' }];
    expect(getBorderColorAndTooltip(edges, nodes, 'A', 'Z').borderColor).toBe('rejected');
  });
});
