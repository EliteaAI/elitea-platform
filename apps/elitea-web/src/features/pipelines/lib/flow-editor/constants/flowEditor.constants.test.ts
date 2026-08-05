import { describe, expect, it } from 'vitest';

import {
  InitialNodeData,
  InitialNodeId,
  NodeDisplayLabels,
  NodeHeightMap,
  PipelineNodeDisplayNames,
  PipelineNodeTypeNames,
  PipelineNodeTypes,
  StateVariableTypes,
} from './flowEditor.constants';

describe('PipelineNodeTypeNames', () => {
  it('inverts PipelineNodeTypes (value -> declared key name)', () => {
    expect(PipelineNodeTypeNames[PipelineNodeTypes.Tool]).toBe('Tool');
    expect(PipelineNodeTypeNames[PipelineNodeTypes.LoopFromTool]).toBe('LoopFromTool');
    expect(PipelineNodeTypeNames[PipelineNodeTypes.End]).toBe('End');
  });
});

describe('NodeHeightMap / PipelineNodeDisplayNames / NodeDisplayLabels', () => {
  it('has an entry for every PipelineNodeTypes value', () => {
    for (const type of Object.values(PipelineNodeTypes)) {
      expect(NodeHeightMap[type]).toBeTypeOf('number');
      expect(PipelineNodeDisplayNames[type]).toBeTypeOf('string');
      expect(NodeDisplayLabels[type]).toBeTypeOf('string');
    }
  });

  it('Hitl label in NodeDisplayLabels matches PipelineNodeDisplayNames (not a hand-duplicated string)', () => {
    expect(NodeDisplayLabels[PipelineNodeTypes.Hitl]).toBe(PipelineNodeDisplayNames[PipelineNodeTypes.Hitl]);
  });
});

describe('InitialNodeId', () => {
  it('covers every PipelineNodeTypes value plus the synthetic run-state node', () => {
    for (const type of Object.values(PipelineNodeTypes)) {
      expect(InitialNodeId[type]).toBeTypeOf('string');
    }
    expect(InitialNodeId['run_state']).toBe('RunState');
  });
});

describe('InitialNodeData', () => {
  it('seeds a Tool node with an empty tool ref and structured-output defaults', () => {
    expect(InitialNodeData[PipelineNodeTypes.Tool]).toEqual({
      tool: '',
      input: [],
      output: [],
      transition: PipelineNodeTypes.End,
      structured_output: false,
    });
  });

  it('seeds a Condition node with empty condition fields', () => {
    expect(InitialNodeData[PipelineNodeTypes.Condition]).toEqual({
      condition_input: [],
      condition_definition: '',
      conditional_outputs: [],
      default_output: '',
    });
  });

  it('seeds a Hitl node with the reject route defaulting to End', () => {
    const hitl = InitialNodeData[PipelineNodeTypes.Hitl];
    expect(hitl?.['routes']).toEqual({ approve: '', edit: '', reject: PipelineNodeTypes.End });
  });

  it('seeds a Function node by layering onto the Tool shape (input_mapping added, function undefined)', () => {
    const fn = InitialNodeData[PipelineNodeTypes.Function];
    expect(fn?.['tool']).toBe('');
    expect(fn?.['input_mapping']).toEqual({});
    expect(fn?.['function']).toBeUndefined();
  });
});

describe('StateVariableTypes', () => {
  it('maps the four DSL type codes', () => {
    expect(StateVariableTypes).toEqual({ String: 'str', Number: 'number', List: 'list', Json: 'dict' });
  });
});
