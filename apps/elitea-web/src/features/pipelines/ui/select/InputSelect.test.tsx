import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { buildFlowEditorContextValue } from '../../__tests__/testUtils';
import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import { InputSelect } from './InputSelect';

describe('InputSelect', () => {
  it('lists state variables as options, none selected by default', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Tool 1', input: [] }], state: { input: { type: 'str' }, messages: { type: 'list' } } },
    });

    const { getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <InputSelect id="Tool 1" />
      </FlowEditorContext.Provider>,
    );

    expect(getByText('Input')).toBeInTheDocument();
  });

  it('reads the current selection from the matching yaml node', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: {
        nodes: [{ id: 'Tool 1', input: ['input'] }],
        state: { input: { type: 'str' }, messages: { type: 'list' } },
      },
    });

    const { getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <InputSelect id="Tool 1" />
      </FlowEditorContext.Provider>,
    );

    expect(getByText('input')).toBeInTheDocument();
  });

  it('synthesises a deletable option for a selected value absent from state', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: {
        nodes: [{ id: 'Tool 1', input: ['stale_variable'] }],
        state: { input: { type: 'str' } },
      },
    });

    const { getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <InputSelect id="Tool 1" />
      </FlowEditorContext.Provider>,
    );

    expect(getByText('stale_variable')).toBeInTheDocument();
  });

  it('calls setYamlJsonObject with the updated input list on chip delete', () => {
    const setYamlJsonObject = vi.fn();
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Tool 1', input: ['input', 'messages'] }], state: { input: { type: 'str' }, messages: { type: 'list' } } },
      setYamlJsonObject,
    });

    const { getAllByTestId } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <InputSelect id="Tool 1" />
      </FlowEditorContext.Provider>,
    );

    const deleteButtons = getAllByTestId('CancelIcon');
    deleteButtons[0]?.closest('svg')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(setYamlJsonObject).toHaveBeenCalled();
  });

  it('renders sensibly with no FlowEditorContext ancestor', () => {
    const { getByText } = renderWithTheme(<InputSelect id="Tool 1" />);
    expect(getByText('Input')).toBeInTheDocument();
  });
});
