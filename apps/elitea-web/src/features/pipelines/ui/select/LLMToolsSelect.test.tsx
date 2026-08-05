import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { buildFlowEditorContextValue } from '../../__tests__/testUtils';
import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import { LLMToolsSelect } from './LLMToolsSelect';

describe('LLMToolsSelect', () => {
  it('shows the toolkit name with a selected/total count', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'LLM 1', tool_names: { github: ['create_issue'] } }] },
    });

    const { getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <LLMToolsSelect
          id="LLM 1"
          toolkitName="github"
          tools={['create_issue', 'list_issues']}
        />
      </FlowEditorContext.Provider>,
    );

    expect(getByText('github (1/2)')).toBeInTheDocument();
  });

  it('drops selected tools that are no longer in the tools list', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'LLM 1', tool_names: { github: ['create_issue', 'removed_tool'] } }] },
    });

    const { getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <LLMToolsSelect
          id="LLM 1"
          toolkitName="github"
          tools={['create_issue', 'list_issues']}
        />
      </FlowEditorContext.Provider>,
    );

    expect(getByText('github (1/2)')).toBeInTheDocument();
  });

  it('updates the tool_names map for this toolkit on selection change', async () => {
    const user = userEvent.setup();
    const setYamlJsonObject = vi.fn();
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'LLM 1', tool_names: { github: [] } }] },
      setYamlJsonObject,
    });

    const { getByRole } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <LLMToolsSelect
          id="LLM 1"
          toolkitName="github"
          tools={['create_issue']}
        />
      </FlowEditorContext.Provider>,
    );

    await user.click(getByRole('combobox'));
    await user.click(getByRole('option', { name: 'create_issue' }));

    expect(setYamlJsonObject).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: [expect.objectContaining({ id: 'LLM 1', tool_names: { github: ['create_issue'] } })],
      }),
    );
  });

  it('renders disabled', () => {
    const contextValue = buildFlowEditorContextValue({ yamlJsonObject: { nodes: [{ id: 'LLM 1' }] } });
    const { getByRole } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <LLMToolsSelect
          id="LLM 1"
          toolkitName="github"
          tools={['create_issue']}
          disabled
        />
      </FlowEditorContext.Provider>,
    );
    expect(getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');
  });
});
