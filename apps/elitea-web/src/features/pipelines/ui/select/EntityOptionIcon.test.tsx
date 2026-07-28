import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { EntityOptionIcon, resolvePipelineToolEntityType } from './EntityOptionIcon';

describe('resolvePipelineToolEntityType', () => {
  it('resolves an application-type tool to "agent" by default', () => {
    expect(resolvePipelineToolEntityType({ type: 'application', name: 'My Agent' })).toBe('agent');
  });

  it('resolves an application-type tool with agent_type "pipeline" to "pipeline"', () => {
    expect(resolvePipelineToolEntityType({ type: 'application', name: 'My Pipeline', agent_type: 'pipeline' })).toBe('pipeline');
  });

  it('resolves a non-application type to "toolkit"', () => {
    expect(resolvePipelineToolEntityType({ type: 'github', name: 'github' })).toBe('toolkit');
  });
});

describe('EntityOptionIcon', () => {
  it('renders for each entity type without throwing', () => {
    for (const entityType of ['agent', 'pipeline', 'toolkit'] as const) {
      const { container } = renderWithTheme(<EntityOptionIcon entityType={entityType} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    }
  });
});
