import { load } from 'js-yaml';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { usePipelineYamlStore } from '../../model/pipelineYamlStore';
import { usePipelineAttachmentYamlSync } from './usePipelineAttachmentYamlSync.hooks';

beforeEach(() => {
  usePipelineYamlStore.setState({
    yamlCode: '',
    yamlJsonObject: {},
    initYamlCode: '',
    initYamlJsonObject: {},
    resetFlag: false,
    layoutVersion: undefined,
  });
});

describe('usePipelineAttachmentYamlSync', () => {
  it('adds input_attachments to state when hasAttachments is true and the key is missing', () => {
    usePipelineYamlStore.setState({ yamlJsonObject: { state: { input: { type: 'str' } } } });

    renderHook(() => usePipelineAttachmentYamlSync(true));

    const state = usePipelineYamlStore.getState();
    expect(state.yamlJsonObject).toMatchObject({
      state: { input: { type: 'str' }, input_attachments: { type: 'list', default: [] } },
    });
    expect(load(state.yamlCode)).toEqual(state.yamlJsonObject);
  });

  it('seeds the DefaultState when the document has no state key yet', () => {
    usePipelineYamlStore.setState({ yamlJsonObject: {} });

    renderHook(() => usePipelineAttachmentYamlSync(true));

    const state = usePipelineYamlStore.getState();
    expect(state.yamlJsonObject).toMatchObject({
      state: { input: { type: 'str' }, messages: { type: 'list' }, input_attachments: { type: 'list', default: [] } },
    });
  });

  it('removes input_attachments from state when hasAttachments flips to false', () => {
    usePipelineYamlStore.setState({
      yamlJsonObject: { state: { input: { type: 'str' }, input_attachments: { type: 'list', default: [] } } },
    });

    renderHook(() => usePipelineAttachmentYamlSync(false));

    const state = usePipelineYamlStore.getState();
    expect(state.yamlJsonObject).toEqual({ state: { input: { type: 'str' } } });
  });

  it('does nothing when hasAttachments is true and the key is already present', () => {
    const yamlJsonObject = { state: { input_attachments: { type: 'list', default: [] } } };
    usePipelineYamlStore.setState({ yamlJsonObject, yamlCode: 'unchanged' });

    renderHook(() => usePipelineAttachmentYamlSync(true));

    expect(usePipelineYamlStore.getState().yamlJsonObject).toBe(yamlJsonObject);
    expect(usePipelineYamlStore.getState().yamlCode).toBe('unchanged');
  });

  it('does nothing when hasAttachments is false and the key is already absent', () => {
    const yamlJsonObject = { state: { input: { type: 'str' } } };
    usePipelineYamlStore.setState({ yamlJsonObject, yamlCode: 'unchanged' });

    renderHook(() => usePipelineAttachmentYamlSync(false));

    expect(usePipelineYamlStore.getState().yamlJsonObject).toBe(yamlJsonObject);
    expect(usePipelineYamlStore.getState().yamlCode).toBe('unchanged');
  });

  it('reacts to hasAttachments changing across a re-render', () => {
    usePipelineYamlStore.setState({ yamlJsonObject: { state: {} } });
    const { rerender } = renderHook(({ hasAttachments }: { hasAttachments: boolean }) => usePipelineAttachmentYamlSync(hasAttachments), {
      initialProps: { hasAttachments: false },
    });

    expect(usePipelineYamlStore.getState().yamlJsonObject).toEqual({ state: {} });

    rerender({ hasAttachments: true });
    expect(usePipelineYamlStore.getState().yamlJsonObject).toMatchObject({
      state: { input_attachments: { type: 'list', default: [] } },
    });
  });
});
