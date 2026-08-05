import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  addedApplicationToolIds,
  addedToolkitIds,
  filterEntityMenuItems,
  filterToolkitMenuItems,
  useFilterAddedItems,
} from './useFilterAddedItems';
import type { FilterableToolRef } from './useFilterAddedItems';

const TOOLS: readonly FilterableToolRef[] = [
  { id: 'gh-1', type: 'github' },
  { id: 'tk-2', type: 'custom' },
  { id: 5, type: 'application', settings: { application_id: 'agent-9' } },
  { id: 6, type: 'application', settings: { application_id: 'pipe-3' } },
  { id: 7, type: 'application', settings: {} }, // no application_id -- must be dropped, not crash
];

describe('addedToolkitIds (pure)', () => {
  it('collects ids of every non-agent/pipeline-typed tool', () => {
    expect(addedToolkitIds(TOOLS)).toEqual(new Set(['gh-1', 'tk-2', 5, 6, 7]));
  });

  it('drops undefined/null/empty-string ids', () => {
    expect(addedToolkitIds([{ id: undefined, type: 'x' }, { id: '', type: 'y' }])).toEqual(new Set());
  });

  it('returns an empty set for an empty tools array', () => {
    expect(addedToolkitIds([])).toEqual(new Set());
  });
});

describe('addedApplicationToolIds (pure)', () => {
  it('collects the referenced application_id of every application-typed tool', () => {
    expect(addedApplicationToolIds(TOOLS)).toEqual(new Set(['agent-9', 'pipe-3']));
  });

  it('skips application-typed tools with no application_id', () => {
    expect(addedApplicationToolIds([{ id: 1, type: 'application', settings: {} }])).toEqual(new Set());
  });
});

describe('filterToolkitMenuItems (pure)', () => {
  it('excludes items whose toolkitId is already added', () => {
    const added = new Set<string | number>(['gh-1']);
    const result = filterToolkitMenuItems([{ toolkitId: 'gh-1' }, { toolkitId: 'jira-1' }], added);
    expect(result).toEqual([{ toolkitId: 'jira-1' }]);
  });

  it('keeps items with no toolkitId (defensive, matches baseline .filter(id => id))', () => {
    const result = filterToolkitMenuItems([{ toolkitId: undefined }], new Set());
    expect(result).toEqual([{ toolkitId: undefined }]);
  });

  it('returns an empty array for undefined input', () => {
    expect(filterToolkitMenuItems(undefined, new Set())).toEqual([]);
  });
});

describe('filterEntityMenuItems (pure)', () => {
  it('excludes items whose data.id is already added', () => {
    const added = new Set<string | number>(['agent-9']);
    const result = filterEntityMenuItems([{ data: { id: 'agent-9' } }, { data: { id: 'agent-10' } }], added);
    expect(result).toEqual([{ data: { id: 'agent-10' } }]);
  });

  it('returns an empty array for undefined input', () => {
    expect(filterEntityMenuItems(undefined, new Set())).toEqual([]);
  });
});

describe('useFilterAddedItems (hook)', () => {
  it('exposes the three id sets and matching filter functions', () => {
    const { result } = renderHook(() => useFilterAddedItems(TOOLS));

    expect(result.current.addedToolkitIds).toEqual(new Set(['gh-1', 'tk-2', 5, 6, 7]));
    expect(result.current.addedAgentIds).toEqual(new Set(['agent-9', 'pipe-3']));
    expect(result.current.addedPipelineIds).toBe(result.current.addedAgentIds);

    expect(result.current.filterToolkits([{ toolkitId: 'gh-1' }, { toolkitId: 'jira-9' }])).toEqual([
      { toolkitId: 'jira-9' },
    ]);
    expect(
      result.current.filterAgents([{ data: { id: 'agent-9' } }, { data: { id: 'agent-11' } }]),
    ).toEqual([{ data: { id: 'agent-11' } }]);
    expect(
      result.current.filterPipelines([{ data: { id: 'pipe-3' } }, { data: { id: 'pipe-4' } }]),
    ).toEqual([{ data: { id: 'pipe-4' } }]);
  });

  it('treats an undefined tools list as empty (nothing filtered out)', () => {
    const { result } = renderHook(() => useFilterAddedItems(undefined));
    expect(result.current.addedToolkitIds.size).toBe(0);
    expect(result.current.filterAgents([{ data: { id: 'agent-1' } }])).toEqual([{ data: { id: 'agent-1' } }]);
  });
});
