import { describe, expect, it } from 'vitest';

import { ToolInitialValues } from './toolInitialValues';
import { ToolOptionsByType } from './toolOptions';

describe('ToolInitialValues', () => {
  it('seeds github with its selected_tools derived from ToolOptionsByType.github', () => {
    const github = ToolInitialValues.github;
    expect(github?.settings.selected_tools).toEqual(ToolOptionsByType.github?.map((option) => option.value));
  });

  it('seeds custom with a fixed name/description and no selected_tools', () => {
    expect(ToolInitialValues.custom).toEqual({
      type: 'custom',
      name: 'Custom tool',
      description: 'custom tool',
      settings: {},
    });
  });

  it('seeds "openapi" with the current inline-spec settings shape', () => {
    // `ToolTypes.open_api.value === ToolTypes.openapi.value === 'openapi'`
    // Both aliases resolve to the same wire type.
    expect(ToolInitialValues.openapi?.settings).toEqual({ spec: '', selected_tools: [] });
    expect(ToolInitialValues.open_api).toBeUndefined();
  });

  it('seeds application with application_id/application_version_id/variables', () => {
    expect(ToolInitialValues.application?.settings).toEqual({
      application_id: '',
      application_version_id: '',
      variables: [],
    });
  });
});
