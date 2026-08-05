import { describe, expect, it } from 'vitest';

import type { PipelineToolEntry } from '../../select/pipelineToolEntry.types';
import { resolveToolkitFieldWrite } from './toolkitWriteHelpers';

describe('resolveToolkitFieldWrite', () => {
  it('writes tool (not toolkit_name) when the toolkit entry is an application', () => {
    const toolkitDetails: PipelineToolEntry = { type: 'application', name: 'sub-agent' };
    expect(resolveToolkitFieldWrite(toolkitDetails, 'sub-agent')).toEqual({ toolkit_name: undefined, tool: 'sub-agent' });
  });

  it('writes toolkit_name (not tool) when the toolkit entry is not an application', () => {
    const toolkitDetails: PipelineToolEntry = { type: 'github', toolkit_name: 'my-github' };
    expect(resolveToolkitFieldWrite(toolkitDetails, 'my-github')).toEqual({ toolkit_name: 'my-github', tool: undefined });
  });

  it('writes toolkit_name when toolkitDetails is undefined', () => {
    expect(resolveToolkitFieldWrite(undefined, 'unknown-toolkit')).toEqual({ toolkit_name: 'unknown-toolkit', tool: undefined });
  });
});
