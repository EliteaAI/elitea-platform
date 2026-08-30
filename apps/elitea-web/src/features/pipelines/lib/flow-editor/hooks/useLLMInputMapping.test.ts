import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FlowEditorContextValue } from '../flowEditorContext';
import { FlowEditorContext } from '../flowEditorContext';
import type { YamlPipelineDocument } from '../helpers/pipelineFlow.types';
import { getDefaultLLMInputMapping, useLLMInputMapping } from './useLLMInputMapping';

function makeWrapper(value: Partial<FlowEditorContextValue>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(FlowEditorContext.Provider, { value: value as FlowEditorContextValue }, children);
  };
}

describe('getDefaultLLMInputMapping', () => {
  it('returns fixed empty defaults for system/task/chat_history', () => {
    expect(getDefaultLLMInputMapping()).toEqual({
      system: { type: 'fixed', value: '' },
      task: { type: 'fixed', value: '' },
      chat_history: { type: 'fixed', value: [] },
    });
  });
});

describe('useLLMInputMapping', () => {
  /*
   * THE CONTRACT: reading a node never writes to the document.
   *
   * The hook used to write a completed `input_mapping` on mount, which cost
   * two real defects — it replaced an authored `task` with an empty default
   * (data loss on open), and even once merged it still added the absent keys,
   * so the unsaved-changes guard armed on a pipeline nobody had touched and
   * blocked the page's own "Chat with pipeline" navigation. Both were
   * intermittent because React Flow only mounts cards that are in view.
   *
   * These cases pin the absence of that write. Counting calls is the whole
   * point here, so unlike most call-count assertions it is not a proxy for
   * something better.
   */
  it('does not touch the document when a node has no input_mapping at all', () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'llm-1' }] };
    const wrapper = makeWrapper({ yamlJsonObject, setYamlJsonObject });

    const { result } = renderHook(() => useLLMInputMapping({ id: 'llm-1' }), { wrapper });

    // The defaults are supplied for DISPLAY...
    expect(result.current.inputMappings).toEqual(getDefaultLLMInputMapping());
    // ...without being written back.
    expect(setYamlJsonObject).not.toHaveBeenCalled();
  });

  it('shows an authored `task` merged with the defaults, and writes nothing', () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [{ id: 'llm-1', input_mapping: { task: { type: 'variable', value: 'input' } } }],
    };
    const wrapper = makeWrapper({ yamlJsonObject, setYamlJsonObject });

    const { result } = renderHook(() => useLLMInputMapping({ id: 'llm-1' }), { wrapper });

    expect(result.current.inputMappings).toEqual({
      system: { type: 'fixed', value: '' },
      task: { type: 'variable', value: 'input' },
      chat_history: { type: 'fixed', value: [] },
    });
    expect(
      setYamlJsonObject,
      'merely opening the pipeline must not rewrite the authored mapping',
    ).not.toHaveBeenCalled();
  });

  it('carries the authored `task` through when the user edits a DIFFERENT key', () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [{ id: 'llm-1', input_mapping: { task: { type: 'variable', value: 'input' } } }],
    };
    const wrapper = makeWrapper({ yamlJsonObject, setYamlJsonObject });

    const { result } = renderHook(() => useLLMInputMapping({ id: 'llm-1' }), { wrapper });
    act(() => {
      result.current.onChangeMapping('system', { type: 'fixed', value: 'be terse' });
    });

    const written = setYamlJsonObject.mock.calls[0]?.[0] as YamlPipelineDocument;
    expect(written.nodes?.[0]?.['input_mapping']).toEqual({
      system: { type: 'fixed', value: 'be terse' },
      task: { type: 'variable', value: 'input' },
      chat_history: { type: 'fixed', value: [] },
    });
  });

  it('does not re-seed once every required key is already present', () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [
        {
          id: 'llm-1',
          input_mapping: {
            system: { type: 'fixed', value: 'sys' },
            task: { type: 'fixed', value: 'task' },
            chat_history: { type: 'fixed', value: [] },
          },
        },
      ],
    };
    const wrapper = makeWrapper({ yamlJsonObject, setYamlJsonObject });

    renderHook(() => useLLMInputMapping({ id: 'llm-1' }), { wrapper });

    expect(setYamlJsonObject).not.toHaveBeenCalled();
  });

  it('onChangeMapping writes a merged input_mapping back through setYamlJsonObject', () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [
        {
          id: 'llm-1',
          input_mapping: {
            system: { type: 'fixed', value: 'sys' },
            task: { type: 'fixed', value: 'task' },
            chat_history: { type: 'fixed', value: [] },
          },
        },
      ],
    };
    const wrapper = makeWrapper({ yamlJsonObject, setYamlJsonObject });

    const { result } = renderHook(() => useLLMInputMapping({ id: 'llm-1' }), { wrapper });

    act(() => {
      result.current.onChangeMapping('task', { type: 'variable', value: 'question' });
    });

    expect(setYamlJsonObject).toHaveBeenCalledTimes(1);
    const written = setYamlJsonObject.mock.calls[0]?.[0] as YamlPipelineDocument;
    expect(written.nodes?.[0]?.['input_mapping']).toEqual({
      system: { type: 'fixed', value: 'sys' },
      task: { type: 'variable', value: 'question' },
      chat_history: { type: 'fixed', value: [] },
    });
  });

  it('is a safe no-op outside a FlowEditorContext.Provider', () => {
    const { result } = renderHook(() => useLLMInputMapping({ id: 'llm-1' }));
    expect(result.current.inputMappings).toEqual(getDefaultLLMInputMapping());
    expect(() => {
      act(() => {
        result.current.onChangeMapping('task', { type: 'fixed', value: 'x' });
      });
    }).not.toThrow();
  });

  it('defaultValues() returns a fresh default mapping', () => {
    const { result } = renderHook(() => useLLMInputMapping({ id: 'llm-1' }));
    expect(result.current.defaultValues()).toEqual(getDefaultLLMInputMapping());
  });
});
