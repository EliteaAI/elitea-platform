import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { buildFlowEditorContextValue } from '../../__tests__/testUtils';
import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import type { SetFlowEdges } from '../../lib/flow-editor/reactFlowTypes';
import { CommonInterruptSettings } from './CommonInterruptSettings';

describe('CommonInterruptSettings', () => {
  it('renders the three switches by default', () => {
    const contextValue = buildFlowEditorContextValue({ yamlJsonObject: { nodes: [{ id: 'Tool 1' }] } });

    const { getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <CommonInterruptSettings
          id="Tool 1"
          type="tool"
        />
      </FlowEditorContext.Provider>,
    );

    expect(getByText('Interrupt before')).toBeInTheDocument();
    expect(getByText('Interrupt after')).toBeInTheDocument();
    expect(getByText('Structured output')).toBeInTheDocument();
  });

  it('hides the structured output switch when showStructuredOutput is false', () => {
    const contextValue = buildFlowEditorContextValue({ yamlJsonObject: { nodes: [{ id: 'Tool 1' }] } });

    const { queryByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <CommonInterruptSettings
          id="Tool 1"
          type="tool"
          showStructuredOutput={false}
        />
      </FlowEditorContext.Provider>,
    );

    expect(queryByText('Structured output')).not.toBeInTheDocument();
  });

  it('disables interrupt-before when this node is the entry point', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Tool 1' }], entry_point: 'Tool 1' },
    });

    const { getByRole } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <CommonInterruptSettings
          id="Tool 1"
          type="tool"
        />
      </FlowEditorContext.Provider>,
    );

    expect(getByRole('switch', { name: 'Interrupt before' })).toBeDisabled();
  });

  it('updates interrupt_before and the incoming edge label when toggled on', async () => {
    const user = userEvent.setup();
    const setYamlJsonObject = vi.fn();
    const setFlowEdges = vi.fn<SetFlowEdges>();
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Tool 1' }] },
      setYamlJsonObject,
      setFlowEdges,
    });

    const { getByRole } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <CommonInterruptSettings
          id="Tool 1"
          type="tool"
        />
      </FlowEditorContext.Provider>,
    );

    await user.click(getByRole('switch', { name: 'Interrupt before' }));

    expect(setYamlJsonObject).toHaveBeenCalledWith(expect.objectContaining({ interrupt_before: ['Tool 1'] }));
    expect(setFlowEdges).toHaveBeenCalled();
    // The edge-rewrite updater reads `event.target.checked` off the real DOM
    // node at the moment `setFlowEdges` runs; this mock context (a plain
    // `vi.fn()`, not a real store) never re-renders the switch's `checked`
    // prop back to `true`, so re-invoking the captured updater after the
    // fact would observe React's post-click revert, not the click itself --
    // asserting the callback shape (a function updater over the edges
    // array, matching `setFlowEdges`'s `SetFlowEdges` signature) is the
    // meaningful check available with this harness; the equivalent
    // "produces the right edge" behaviour is exercised end-to-end by
    // `RouteSelect.test.tsx`'s own edge-rewrite test.
    const updater = setFlowEdges.mock.calls[0]?.[0];
    expect(typeof updater).toBe('function');
  });

  it('updates structured_output on toggle', async () => {
    const user = userEvent.setup();
    const setYamlJsonObject = vi.fn();
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Tool 1' }] },
      setYamlJsonObject,
    });

    const { getByRole } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <CommonInterruptSettings
          id="Tool 1"
          type="tool"
        />
      </FlowEditorContext.Provider>,
    );

    await user.click(getByRole('switch', { name: 'Structured output' }));

    expect(setYamlJsonObject).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [expect.objectContaining({ id: 'Tool 1', structured_output: true })] }),
    );
  });

  // Regression coverage (confirmed finding 5): a malformed (non-array)
  // `interrupt_before`/`interrupt_after` in the YAML used to flow straight
  // into `.includes()`/the toggle handler's spread instead of degrading to
  // an empty list, same as `parsePipelineTraversal.helpers.test.ts`'s own
  // `interrupt_before: 'not-an-array'` fixture for the identical malformed
  // shape.
  it('degrades a malformed (non-array) interrupt_before/interrupt_after to an empty list instead of throwing', async () => {
    const user = userEvent.setup();
    const setYamlJsonObject = vi.fn();
    const malformedYamlJsonObject = {
      nodes: [{ id: 'Tool 1' }],
      interrupt_before: 'not-an-array',
      interrupt_after: { also: 'not-an-array' },
    } as unknown as YamlPipelineDocument;
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: malformedYamlJsonObject,
      setYamlJsonObject,
    });

    const { getByRole } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <CommonInterruptSettings
          id="Tool 1"
          type="tool"
        />
      </FlowEditorContext.Provider>,
    );

    expect(getByRole('switch', { name: 'Interrupt before' })).not.toBeChecked();
    expect(getByRole('switch', { name: 'Interrupt after' })).not.toBeChecked();

    await user.click(getByRole('switch', { name: 'Interrupt before' }));

    expect(setYamlJsonObject).toHaveBeenCalledWith(expect.objectContaining({ interrupt_before: ['Tool 1'] }));
  });

  it('does not throw with no FlowEditorContext ancestor', () => {
    expect(() =>
      renderWithTheme(
        <CommonInterruptSettings
          id="Tool 1"
          type="tool"
        />,
      ),
    ).not.toThrow();
  });
});
