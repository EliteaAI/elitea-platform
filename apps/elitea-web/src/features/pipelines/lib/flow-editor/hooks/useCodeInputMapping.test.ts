import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FlowEditorContextValue } from '../flowEditorContext';
import { FlowEditorContext } from '../flowEditorContext';
import { getDefaultCodeInputMapping, useCodeInputMapping } from './useCodeInputMapping';

function makeWrapper(value: Partial<FlowEditorContextValue>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(FlowEditorContext.Provider, { value: value as FlowEditorContextValue }, children);
  };
}

describe('getDefaultCodeInputMapping', () => {
  it('returns a fixed, empty code mapping', () => {
    expect(getDefaultCodeInputMapping()).toEqual({ code: { type: 'fixed', value: '' } });
  });
});

describe('useCodeInputMapping', () => {
  it('returns the existing typed code mapping from the yaml node', () => {
    const wrapper = makeWrapper({
      yamlJsonObject: { nodes: [{ id: 'Code 1', code: { type: 'fstring', value: 'print(1)' } }] },
      setYamlJsonObject: vi.fn(),
    });

    const { result } = renderHook(() => useCodeInputMapping({ id: 'Code 1' }), { wrapper });

    expect(result.current.inputMappings).toEqual({ code: { type: 'fstring', value: 'print(1)' } });
    expect(result.current.defaultValues).toEqual({ code: '' });
  });

  it('converts a legacy bare-string code value into a fixed mapping', () => {
    const wrapper = makeWrapper({
      yamlJsonObject: { nodes: [{ id: 'Code 1', code: 'legacy-code' as never }] },
      setYamlJsonObject: vi.fn(),
    });

    const { result } = renderHook(() => useCodeInputMapping({ id: 'Code 1' }), { wrapper });

    expect(result.current.inputMappings).toEqual({ code: { type: 'fixed', value: 'legacy-code' } });
  });

  it('falls back to the default mapping when the node has no code yet', () => {
    const wrapper = makeWrapper({
      yamlJsonObject: { nodes: [{ id: 'Code 1' }] },
      setYamlJsonObject: vi.fn(),
    });

    const { result } = renderHook(() => useCodeInputMapping({ id: 'Code 1' }), { wrapper });

    expect(result.current.inputMappings).toEqual({ code: { type: 'fixed', value: '' } });
  });

  it('seeds the yaml node with the default code mapping on mount when code is missing', () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject = { nodes: [{ id: 'Code 1' }] };
    const wrapper = makeWrapper({ yamlJsonObject, setYamlJsonObject });

    renderHook(() => useCodeInputMapping({ id: 'Code 1' }), { wrapper });

    expect(setYamlJsonObject).toHaveBeenCalledTimes(1);
    expect(setYamlJsonObject).toHaveBeenCalledWith({
      nodes: [{ id: 'Code 1', code: { type: 'fixed', value: '' } }],
    });
  });

  it('does not overwrite an already-present code field on mount', () => {
    const setYamlJsonObject = vi.fn();
    const wrapper = makeWrapper({
      yamlJsonObject: { nodes: [{ id: 'Code 1', code: { type: 'fixed', value: 'kept' } }] },
      setYamlJsonObject,
    });

    renderHook(() => useCodeInputMapping({ id: 'Code 1' }), { wrapper });

    expect(setYamlJsonObject).not.toHaveBeenCalled();
  });

  it('onChangeMapping batch-updates the node code field', () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject = { nodes: [{ id: 'Code 1', code: { type: 'fixed', value: 'a' } }] };
    const wrapper = makeWrapper({ yamlJsonObject, setYamlJsonObject });

    const { result } = renderHook(() => useCodeInputMapping({ id: 'Code 1' }), { wrapper });

    act(() => {
      result.current.onChangeMapping('code', { type: 'fstring', value: 'b' });
    });

    expect(setYamlJsonObject).toHaveBeenLastCalledWith({
      nodes: [{ id: 'Code 1', code: { type: 'fstring', value: 'b' } }],
    });
  });

  it('does nothing outside a FlowEditorContext.Provider', () => {
    const { result } = renderHook(() => useCodeInputMapping({ id: 'Code 1' }));
    expect(result.current.inputMappings).toEqual({ code: { type: 'fixed', value: '' } });
    expect(() => result.current.onChangeMapping('code', { type: 'fixed', value: 'x' })).not.toThrow();
  });
});
