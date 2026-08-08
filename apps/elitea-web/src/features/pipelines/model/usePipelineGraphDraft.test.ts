import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { LAYOUT_VERSION, ORIENTATION } from '../lib/flow-editor/constants/flowEditor.constants';
import { usePipelineEditorStore } from './pipelineEditorStore';
import { usePipelineYamlStore } from './pipelineYamlStore';
import { usePipelineGraphDraft } from './usePipelineGraphDraft';
import type { PipelineGraphDraft } from './usePipelineGraphDraft';

const PIPELINE_YAML = `entry_point: Agent 1
nodes:
  - id: Agent 1
    type: llm
    transitions:
      - END
`;

beforeEach(() => {
  usePipelineYamlStore.setState({
    yamlCode: '',
    yamlJsonObject: {},
    initYamlCode: '',
    initYamlJsonObject: {},
    resetFlag: false,
    layoutVersion: undefined,
  });
  usePipelineEditorStore.setState({ nodes: [], edges: [] });
});

describe('usePipelineGraphDraft', () => {
  it('returns undefined while the editor stores hold nothing — a save must not blank a stored graph it was never showing (issue 135)', () => {
    const { result } = renderHook(() => usePipelineGraphDraft());
    expect(result.current()).toBeUndefined();
  });

  it('returns undefined for whitespace-only YAML too', () => {
    usePipelineYamlStore.setState({ yamlCode: '   \n  ' });
    const { result } = renderHook(() => usePipelineGraphDraft());
    expect(result.current()).toBeUndefined();
  });

  it('carries the LIVE yamlCode as `instructions` — the pipeline graph IS the YAML (baseline useSaveVersion.js:96)', () => {
    usePipelineYamlStore.setState({ yamlCode: PIPELINE_YAML });
    const { result } = renderHook(() => usePipelineGraphDraft());
    expect(result.current()?.instructions).toBe(PIPELINE_YAML);
  });

  it('lays the parsed YAML out into pipeline_settings.nodes, including the node the user just added', () => {
    usePipelineYamlStore.setState({ yamlCode: PIPELINE_YAML });
    const { result } = renderHook(() => usePipelineGraphDraft());

    const draft = result.current();
    expect(draft).toBeDefined();
    const settings = (draft as PipelineGraphDraft).pipelineSettings;
    const ids = (settings.nodes as readonly { readonly id: string }[]).map((node) => node.id);
    expect(ids).toContain('Agent 1');
    expect(settings.orientation).toBe(ORIENTATION.vertical);
    expect(settings.layout_version).toBe(LAYOUT_VERSION);
  });

  it('every laid-out node carries a position — this is the geometry the next load restores', () => {
    usePipelineYamlStore.setState({ yamlCode: PIPELINE_YAML });
    const { result } = renderHook(() => usePipelineGraphDraft());

    const draft = result.current();
    expect(draft).toBeDefined();
    const nodes = (draft as PipelineGraphDraft).pipelineSettings.nodes as readonly { readonly position?: { x: number; y: number } }[];
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(typeof node.position?.x).toBe('number');
      expect(typeof node.position?.y).toBe('number');
    }
  });

  it('reads the stores at CALL time, not at render time — the save handler runs long after the hook rendered', () => {
    const { result } = renderHook(() => usePipelineGraphDraft());
    expect(result.current()).toBeUndefined();

    usePipelineYamlStore.setState({ yamlCode: PIPELINE_YAML });

    expect(result.current()?.instructions).toBe(PIPELINE_YAML);
  });

  it('unparseable YAML yields an empty graph rather than throwing out of the save handler', () => {
    usePipelineYamlStore.setState({ yamlCode: '\tnot: [valid' });
    const { result } = renderHook(() => usePipelineGraphDraft());

    expect(result.current()?.pipelineSettings.nodes).toEqual([]);
    expect(result.current()?.pipelineSettings.edges).toEqual([]);
  });
});
