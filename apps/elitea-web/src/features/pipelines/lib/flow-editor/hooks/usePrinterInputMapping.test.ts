import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FlowEditorContextValue } from '../flowEditorContext';
import { FlowEditorContext } from '../flowEditorContext';
import { getDefaultPrinterInputMapping, usePrinterInputMapping } from './usePrinterInputMapping';

function makeWrapper(value: Partial<FlowEditorContextValue>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(FlowEditorContext.Provider, { value: value as FlowEditorContextValue }, children);
  };
}

describe('getDefaultPrinterInputMapping', () => {
  it('returns a fixed, empty printer mapping', () => {
    expect(getDefaultPrinterInputMapping()).toEqual({ printer: { type: 'fixed', value: '' } });
  });
});

describe('usePrinterInputMapping', () => {
  it('merges the existing input_mapping with the printer default', () => {
    const wrapper = makeWrapper({
      yamlJsonObject: {
        nodes: [{ id: 'Printer 1', input_mapping: { printer: { type: 'variable', value: 'state.output' } } }],
      },
      setYamlJsonObject: vi.fn(),
    });

    const { result } = renderHook(() => usePrinterInputMapping({ id: 'Printer 1' }), { wrapper });

    expect(result.current.inputMappings).toEqual({ printer: { type: 'variable', value: 'state.output' } });
    expect(result.current.defaultValues).toEqual({ printer: '' });
  });

  it('falls back to the default mapping when input_mapping is missing', () => {
    const wrapper = makeWrapper({
      yamlJsonObject: { nodes: [{ id: 'Printer 1' }] },
      setYamlJsonObject: vi.fn(),
    });

    const { result } = renderHook(() => usePrinterInputMapping({ id: 'Printer 1' }), { wrapper });

    expect(result.current.inputMappings).toEqual({ printer: { type: 'fixed', value: '' } });
  });

  it('seeds the yaml node with the default input_mapping on mount when printer is missing', () => {
    const setYamlJsonObject = vi.fn();
    const wrapper = makeWrapper({
      yamlJsonObject: { nodes: [{ id: 'Printer 1' }] },
      setYamlJsonObject,
    });

    renderHook(() => usePrinterInputMapping({ id: 'Printer 1' }), { wrapper });

    expect(setYamlJsonObject).toHaveBeenCalledTimes(1);
    expect(setYamlJsonObject).toHaveBeenCalledWith({
      nodes: [{ id: 'Printer 1', input_mapping: { printer: { type: 'fixed', value: '' } } }],
    });
  });

  it('does not overwrite an already-complete input_mapping on mount', () => {
    const setYamlJsonObject = vi.fn();
    const wrapper = makeWrapper({
      yamlJsonObject: {
        nodes: [{ id: 'Printer 1', input_mapping: { printer: { type: 'fixed', value: 'kept' } } }],
      },
      setYamlJsonObject,
    });

    renderHook(() => usePrinterInputMapping({ id: 'Printer 1' }), { wrapper });

    expect(setYamlJsonObject).not.toHaveBeenCalled();
  });

  it('onChangeMapping batch-updates the merged input_mapping', () => {
    const setYamlJsonObject = vi.fn();
    const wrapper = makeWrapper({
      yamlJsonObject: {
        nodes: [{ id: 'Printer 1', input_mapping: { printer: { type: 'fixed', value: 'a' } } }],
      },
      setYamlJsonObject,
    });

    const { result } = renderHook(() => usePrinterInputMapping({ id: 'Printer 1' }), { wrapper });

    act(() => {
      result.current.onChangeMapping('printer', { type: 'fixed', value: 'b' });
    });

    expect(setYamlJsonObject).toHaveBeenLastCalledWith({
      nodes: [{ id: 'Printer 1', input_mapping: { printer: { type: 'fixed', value: 'b' } } }],
    });
  });

  it('does nothing outside a FlowEditorContext.Provider', () => {
    const { result } = renderHook(() => usePrinterInputMapping({ id: 'Printer 1' }));
    expect(result.current.inputMappings).toEqual({ printer: { type: 'fixed', value: '' } });
    expect(() => result.current.onChangeMapping('printer', { type: 'fixed', value: 'x' })).not.toThrow();
  });
});
