import { createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { FlowEditorContextValue } from '../flowEditorContext';
import { FlowEditorContext } from '../flowEditorContext';
import { useInputOptions } from './useInputOptions';

function makeWrapper(value: Pick<FlowEditorContextValue, 'yamlJsonObject'>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(FlowEditorContext.Provider, { value: value as FlowEditorContextValue }, children);
  };
}

describe('useInputOptions', () => {
  it('defaults to input/messages when the yaml has no state block', () => {
    const wrapper = makeWrapper({ yamlJsonObject: {} });
    const { result } = renderHook(() => useInputOptions(), { wrapper });
    expect(result.current).toEqual([
      { label: 'input', value: 'input' },
      { label: 'messages', value: 'messages' },
    ]);
  });

  it('puts input/messages first, then the rest alphabetically', () => {
    const wrapper = makeWrapper({
      yamlJsonObject: { state: { zebra: { type: 'str' }, messages: { type: 'list' }, apple: { type: 'str' }, input: { type: 'str' } } },
    });
    const { result } = renderHook(() => useInputOptions(), { wrapper });
    expect(result.current.map(option => option.value)).toEqual(['input', 'messages', 'apple', 'zebra']);
  });

  it('falls back to the same input/messages default outside a FlowEditorContext.Provider', () => {
    const { result } = renderHook(() => useInputOptions());
    expect(result.current).toEqual([
      { label: 'input', value: 'input' },
      { label: 'messages', value: 'messages' },
    ]);
  });
});
