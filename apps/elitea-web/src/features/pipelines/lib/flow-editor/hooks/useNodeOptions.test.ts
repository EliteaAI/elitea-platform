import { createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { FlowEditorContextValue } from '../flowEditorContext';
import { FlowEditorContext } from '../flowEditorContext';
import { useNodeOptions } from './useNodeOptions';

function makeWrapper(value: Pick<FlowEditorContextValue, 'yamlJsonObject'>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(FlowEditorContext.Provider, { value: value as FlowEditorContextValue }, children);
  };
}

describe('useNodeOptions', () => {
  it('maps every yaml node to a { label, value } option keyed by node id', () => {
    const wrapper = makeWrapper({
      yamlJsonObject: { nodes: [{ id: 'Agent 1' }, { id: 'Tool 1' }] },
    });

    const { result } = renderHook(() => useNodeOptions(), { wrapper });

    expect(result.current).toEqual([
      { label: 'Agent 1', value: 'Agent 1' },
      { label: 'Tool 1', value: 'Tool 1' },
    ]);
  });

  it('applies the nodeFilter predicate', () => {
    const wrapper = makeWrapper({
      yamlJsonObject: { nodes: [{ id: 'Agent 1', type: 'agent' }, { id: 'Tool 1', type: 'tool' }] },
    });

    const { result } = renderHook(() => useNodeOptions(node => node.type === 'agent'), { wrapper });

    expect(result.current).toEqual([{ label: 'Agent 1', value: 'Agent 1' }]);
  });

  it('appends an END option when addEndNode is true', () => {
    const wrapper = makeWrapper({ yamlJsonObject: { nodes: [{ id: 'Agent 1' }] } });

    const { result } = renderHook(() => useNodeOptions(undefined, true), { wrapper });

    expect(result.current).toEqual([
      { label: 'Agent 1', value: 'Agent 1' },
      { label: 'END', value: 'END' },
    ]);
  });

  it('returns an empty list outside a FlowEditorContext.Provider', () => {
    const { result } = renderHook(() => useNodeOptions());
    expect(result.current).toEqual([]);
  });
});
