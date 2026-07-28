import { describe, expect, it } from 'vitest';

import { FlowEditorConstants, StateDrawerConstants, ValidationErrors } from './index';

describe('constants barrel (unit A2c symbols)', () => {
  it('re-exports FlowEditorConstants as a namespace with real values', () => {
    expect(FlowEditorConstants.PipelineNodeTypes.Tool).toBe('tool');
  });

  it('re-exports StateDrawerConstants as a namespace with real values', () => {
    expect(StateDrawerConstants.ItemMode.Create).toBe('create');
  });

  it('re-exports ValidationErrors directly', () => {
    expect(ValidationErrors.VariableNameExists).toBe('Name already exists');
  });
});
