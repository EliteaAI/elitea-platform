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
  it('seeds a fully-defaulted mapping onto a node with no input_mapping at all', () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = { nodes: [{ id: 'llm-1' }] };
    const wrapper = makeWrapper({ yamlJsonObject, setYamlJsonObject });

    const { result } = renderHook(() => useLLMInputMapping({ id: 'llm-1' }), { wrapper });

    expect(result.current.inputMappings).toEqual(getDefaultLLMInputMapping());
    expect(setYamlJsonObject).toHaveBeenCalledTimes(1);
    const written = setYamlJsonObject.mock.calls[0]?.[0] as YamlPipelineDocument;
    expect(written.nodes?.[0]?.['input_mapping']).toEqual(getDefaultLLMInputMapping());
  });

  it('merges an existing partial mapping with the defaults instead of dropping it', () => {
    const setYamlJsonObject = vi.fn();
    const yamlJsonObject: YamlPipelineDocument = {
      nodes: [
        {
          id: 'llm-1',
          input_mapping: { system: { type: 'variable', value: 'persona' } },
        },
      ],
    };
    const wrapper = makeWrapper({ yamlJsonObject, setYamlJsonObject });

    const { result } = renderHook(() => useLLMInputMapping({ id: 'llm-1' }), { wrapper });

    expect(result.current.inputMappings).toEqual({
      system: { type: 'variable', value: 'persona' },
      task: { type: 'fixed', value: '' },
      chat_history: { type: 'fixed', value: [] },
    });
    // Missing keys (task/chat_history) trigger the same re-seed write as the empty case.
    expect(setYamlJsonObject).toHaveBeenCalledTimes(1);
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
