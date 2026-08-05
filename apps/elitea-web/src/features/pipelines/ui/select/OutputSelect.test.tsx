import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { buildFlowEditorContextValue } from '../../__tests__/testUtils';
import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import { OutputSelect } from './OutputSelect';

describe('OutputSelect', () => {
  it('renders the Output label by default', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Tool 1', output: [] }], state: { input: { type: 'str' } } },
    });

    const { getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <OutputSelect id="Tool 1" />
      </FlowEditorContext.Provider>,
    );

    expect(getByText('Output')).toBeInTheDocument();
  });

  it('shows a "Not in state" tooltip-carrying chip for a stale selected output', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Tool 1', output: ['gone'] }], state: { input: { type: 'str' } } },
    });

    const { getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <OutputSelect id="Tool 1" />
      </FlowEditorContext.Provider>,
    );

    expect(getByText('gone')).toBeInTheDocument();
  });

  it('is disabled while the pipeline is running', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Tool 1', output: [] }] },
      isRunningPipeline: true,
    });

    const { container } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <OutputSelect id="Tool 1" />
      </FlowEditorContext.Provider>,
    );

    expect(container.querySelector('.Mui-disabled')).toBeInTheDocument();
  });

  it('respects the disabled prop even when not running', () => {
    const contextValue = buildFlowEditorContextValue({ yamlJsonObject: { nodes: [{ id: 'Tool 1', output: [] }] } });

    const { container } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <OutputSelect
          id="Tool 1"
          disabled
        />
      </FlowEditorContext.Provider>,
    );

    expect(container.querySelector('.Mui-disabled')).toBeInTheDocument();
  });

  it('is not disabled when neither disabled nor isRunningPipeline is set', () => {
    const contextValue = buildFlowEditorContextValue({ yamlJsonObject: { nodes: [{ id: 'Tool 1', output: [] }] } });

    const { container } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <OutputSelect id="Tool 1" />
      </FlowEditorContext.Provider>,
    );

    expect(container.querySelector('.Mui-disabled')).not.toBeInTheDocument();
  });

  it('does not throw when setYamlJsonObject is unavailable', () => {
    const setYamlJsonObject = vi.fn();
    const contextValue = buildFlowEditorContextValue({ yamlJsonObject: { nodes: [{ id: 'Tool 1', output: [] }] }, setYamlJsonObject });

    expect(() =>
      renderWithTheme(
        <FlowEditorContext.Provider value={contextValue}>
          <OutputSelect id="Tool 1" />
        </FlowEditorContext.Provider>,
      ),
    ).not.toThrow();
  });
});
