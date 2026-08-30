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

  /*
   * The interrupt switches used to write `interrupt_before`/`interrupt_after`
   * and relabel the edge. They are now permanently disabled: the native Rust
   * runtime refuses ANY pipeline that declares a static interrupt
   * (`services/elitea-worker-rust/src/agents/graph/compiler.rs:470-474`)
   * while the Python SDK worker honours them, and the editor cannot know
   * which worker will take a turn — so it authors the intersection. Flipping
   * one used to turn a working pipeline into one that would not start, with
   * no signal until a chat turn failed in another process.
   *
   * Asserted as three separate facts, because "disabled" alone would also be
   * satisfied by the pre-existing entry-point/END-transition disabling: the
   * control is disabled for an ORDINARY node, clicking it writes nothing,
   * and a reason is on screen.
   */
  it('leaves both interrupt switches disabled on an ordinary node, and says why', async () => {
    // `pointerEventsCheck: 0` forces the click through: user-event otherwise
    // refuses to dispatch on a `pointer-events: none` control, which would
    // make "nothing was written" true for the wrong reason. Forced, the
    // click really is delivered and the handler really is absent.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const setYamlJsonObject = vi.fn();
    const setFlowEdges = vi.fn<SetFlowEdges>();
    const contextValue = buildFlowEditorContextValue({
      // Neither the entry point nor an END transition — the two states that
      // already disabled a switch before this change.
      yamlJsonObject: { nodes: [{ id: 'Tool 1', type: 'tool', transition: 'Tool 2' }], entry_point: 'Tool 2' },
      setYamlJsonObject,
      setFlowEdges,
    });

    const { getByRole, getByText } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <CommonInterruptSettings
          id="Tool 1"
          type="tool"
        />
      </FlowEditorContext.Provider>,
    );

    const before = getByRole('switch', { name: 'Interrupt before' });
    const after = getByRole('switch', { name: 'Interrupt after' });
    expect(before).toBeDisabled();
    expect(after).toBeDisabled();

    await user.click(before);
    await user.click(after);

    expect(setYamlJsonObject).not.toHaveBeenCalled();
    expect(setFlowEdges).not.toHaveBeenCalled();
    expect(getByText(/native pipeline runtime refuses/i)).toBeInTheDocument();
  });

  it('still shows an interrupt a stored document already carries, so it can be found and removed', () => {
    const contextValue = buildFlowEditorContextValue({
      yamlJsonObject: { nodes: [{ id: 'Tool 1', type: 'tool' }], interrupt_before: ['Tool 1'] },
    });

    const { getByRole } = renderWithTheme(
      <FlowEditorContext.Provider value={contextValue}>
        <CommonInterruptSettings
          id="Tool 1"
          type="tool"
        />
      </FlowEditorContext.Provider>,
    );

    expect(getByRole('switch', { name: 'Interrupt before' })).toBeChecked();
    expect(getByRole('switch', { name: 'Interrupt before' })).toBeDisabled();
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
  it('degrades a malformed (non-array) interrupt_before/interrupt_after to an empty list instead of throwing', () => {
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
    expect(setYamlJsonObject).not.toHaveBeenCalled();
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
