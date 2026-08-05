import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentToolAssociation } from '../types';
import { useSaveAgentToolVariables } from './useSaveAgentToolVariables';

const TOOL: AgentToolAssociation = {
  id: 't1',
  name: 'Github',
  variables: [
    { name: 'API_KEY', value: 'old-key' },
    { name: 'ORG', value: 'acme' },
  ],
};
const OTHER_TOOL: AgentToolAssociation = { id: 't2', name: 'Slack', variables: [{ name: 'TOKEN', value: 'x' }] };

describe('useSaveAgentToolVariables', () => {
  it('starts with variables collapsed and exposes the tool\'s current variables', () => {
    const { result } = renderHook(() =>
      useSaveAgentToolVariables({ tool: TOOL, tools: [TOOL], onChangeTools: vi.fn() }),
    );
    expect(result.current.showVariables).toBe(false);
    expect(result.current.variables).toStrictEqual(TOOL.variables);
  });

  it('onToggleVariables stops propagation and flips showVariables', () => {
    const { result } = renderHook(() =>
      useSaveAgentToolVariables({ tool: TOOL, tools: [TOOL], onChangeTools: vi.fn() }),
    );
    const stopPropagation = vi.fn();
    act(() => result.current.onToggleVariables({ stopPropagation }));
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(result.current.showVariables).toBe(true);
    act(() => result.current.onToggleVariables({ stopPropagation }));
    expect(result.current.showVariables).toBe(false);
  });

  it('onChangeVariable rewrites only the matching variable on the matching tool, leaving other tools untouched', () => {
    const onChangeTools = vi.fn();
    const { result } = renderHook(() =>
      useSaveAgentToolVariables({ tool: TOOL, tools: [TOOL, OTHER_TOOL], onChangeTools }),
    );
    act(() => result.current.onChangeVariable('API_KEY', 'new-key'));

    expect(onChangeTools).toHaveBeenCalledOnce();
    const updatedTools = onChangeTools.mock.calls[0]?.[0] as readonly AgentToolAssociation[];
    expect(updatedTools).toStrictEqual([
      {
        ...TOOL,
        variables: [
          { name: 'API_KEY', value: 'new-key' },
          { name: 'ORG', value: 'acme' },
        ],
      },
      OTHER_TOOL,
    ]);
  });

  it('handles a tool with no variables (defaults to an empty array)', () => {
    const bareTool: AgentToolAssociation = { id: 't3', name: 'Bare' };
    const { result } = renderHook(() =>
      useSaveAgentToolVariables({ tool: bareTool, tools: [bareTool], onChangeTools: vi.fn() }),
    );
    expect(result.current.variables).toStrictEqual([]);
  });
});
