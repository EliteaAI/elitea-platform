import type { ReactElement } from 'react';

import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { FlowEditorContextValue } from '../../lib/flow-editor/flowEditorContext';
import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import { CustomNodeInput } from './CustomNodeInput';

installCodeMirrorTestPolyfills();

function getContent(container: HTMLElement): HTMLElement {
  const content = container.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) throw new Error('CodeMirror content element not found');
  return content;
}

/** Selects the whole document and deletes it, leaving an empty editor ready for `user.type`. */
async function clearEditor(user: ReturnType<typeof userEvent.setup>, content: HTMLElement): Promise<void> {
  await user.click(content);
  await user.keyboard('{Control>}a{/Control}{Backspace}');
}

function renderWithContext(value: Partial<FlowEditorContextValue>, ui: ReactElement) {
  const contextValue: FlowEditorContextValue = {
    yamlJsonObject: {},
    setYamlJsonObject: vi.fn(),
    setFlowNodes: vi.fn(),
    setFlowEdges: vi.fn(),
    ...value,
  };
  const result = renderWithTheme(<FlowEditorContext.Provider value={contextValue}>{ui}</FlowEditorContext.Provider>);
  return { ...result, contextValue };
}

describe('CustomNodeInput', () => {
  it('renders "{}" when no matching node exists in the yaml document', () => {
    const { container } = renderWithContext({ yamlJsonObject: { nodes: [] } }, <CustomNodeInput id="missing" />);
    expect(getContent(container)).toHaveTextContent('{}');
  });

  it("renders the matching node's own fields, minus its id", () => {
    const { container } = renderWithContext(
      { yamlJsonObject: { nodes: [{ id: 'node-1', type: 'custom', description: 'hi' }] } },
      <CustomNodeInput id="node-1" />,
    );
    const text = getContent(container).textContent ?? '';
    expect(text).toContain('"type": "custom"');
    expect(text).toContain('"description": "hi"');
    expect(text).not.toContain('"id"');
  });

  it('commits a valid edit on blur via setYamlJsonObject', async () => {
    const user = userEvent.setup();
    const { container, contextValue } = renderWithContext(
      { yamlJsonObject: { nodes: [{ id: 'node-1', type: 'custom' }] } },
      <CustomNodeInput id="node-1" />,
    );
    const content = getContent(container);
    await clearEditor(user, content);
    // `{{` is user-event's own escape for a literal `{` (its keyboard syntax
    // otherwise treats a bare `{` as the start of a special-key sequence);
    // `}` needs no escaping (only `{`/`[` do, per user-event's own docs).
    await user.type(content, '{{"type": "custom", "description": "new"}', { skipClick: true });
    fireEvent.blur(content);
    await vi.waitFor(() => {
      expect(contextValue.setYamlJsonObject).toHaveBeenCalled();
    });
  });

  it('shows a validation error and does not commit when the edited JSON has no "type" field', async () => {
    const user = userEvent.setup();
    const { container, contextValue, findByText } = renderWithContext(
      { yamlJsonObject: { nodes: [{ id: 'node-1', type: 'custom' }] } },
      <CustomNodeInput id="node-1" />,
    );
    const content = getContent(container);
    await clearEditor(user, content);
    await user.type(content, '{{}', { skipClick: true });
    fireEvent.blur(content);
    expect(await findByText('JSON must have name, description, and settings fields')).toBeInTheDocument();
    expect(contextValue.setYamlJsonObject).not.toHaveBeenCalled();
  });

  it('shows a validation error for unparsable JSON', async () => {
    const user = userEvent.setup();
    const { container, findByText } = renderWithContext(
      { yamlJsonObject: { nodes: [{ id: 'node-1', type: 'custom' }] } },
      <CustomNodeInput id="node-1" />,
    );
    const content = getContent(container);
    await clearEditor(user, content);
    await user.type(content, 'not json', { skipClick: true });
    fireEvent.blur(content);
    expect(await findByText('Invalid node format')).toBeInTheDocument();
  });

  it('does not accept edits while a pipeline run is in progress', async () => {
    const user = userEvent.setup();
    const { container } = renderWithContext(
      { yamlJsonObject: { nodes: [{ id: 'node-1', type: 'custom' }] }, isRunningPipeline: true },
      <CustomNodeInput id="node-1" />,
    );
    const content = getContent(container);
    const before = content.textContent;
    await user.click(content);
    await user.keyboard('X');
    expect(content.textContent).toBe(before);
  });

  it('shows the hover toolbar (copy / full screen / expand) only while hovering', async () => {
    const user = userEvent.setup();
    const { getByRole, queryByRole, container } = renderWithContext(
      { yamlJsonObject: { nodes: [{ id: 'node-1', type: 'custom' }] } },
      <CustomNodeInput id="node-1" />,
    );
    expect(queryByRole('button', { name: 'Copy to clipboard' })).not.toBeInTheDocument();

    const editorBox = container.querySelector('.nowheel');
    if (!(editorBox instanceof HTMLElement)) throw new Error('editor container not found');
    await user.hover(editorBox);
    expect(getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Full screen view' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Expand editor' })).toBeInTheDocument();
  });

  it('toggles the expand/collapse editor-height action label on click', async () => {
    const user = userEvent.setup();
    const { getByRole, container } = renderWithContext(
      { yamlJsonObject: { nodes: [{ id: 'node-1', type: 'custom' }] } },
      <CustomNodeInput id="node-1" />,
    );
    const editorBox = container.querySelector('.nowheel');
    if (!(editorBox instanceof HTMLElement)) throw new Error('editor container not found');
    await user.hover(editorBox);
    // `fireEvent.click` (a single, immediate `click` event), not
    // `user.click` (hover→mousedown→mouseup→click as a full synthetic
    // sequence): `user.click`'s intermediate pointer-move steps fire a
    // spurious `mouseleave` on this hover-revealed toolbar's own ancestor
    // `Box` partway through the sequence — reproduced in isolation against
    // a minimal `onMouseEnter`/`onMouseLeave`-gated `IconButton` fixture
    // with a no-op `onClick`, confirming it is a `user-event`/jsdom
    // synthetic-event-ordering artifact of clicking a hover-conditional
    // nested button, not a bug in this component's own hover/click wiring.
    fireEvent.click(getByRole('button', { name: 'Expand editor' }));
    expect(getByRole('button', { name: 'Collapse editor' })).toBeInTheDocument();
  });

  it('opens the fullscreen modal from the toolbar and closes it again', async () => {
    const user = userEvent.setup();
    const { getByRole, getByText, queryByText, container } = renderWithContext(
      { yamlJsonObject: { nodes: [{ id: 'node-1', type: 'custom' }] } },
      <CustomNodeInput id="node-1" />,
    );
    const editorBox = container.querySelector('.nowheel');
    if (!(editorBox instanceof HTMLElement)) throw new Error('editor container not found');
    await user.hover(editorBox);
    // See the identical `fireEvent.click` note in the test above.
    fireEvent.click(getByRole('button', { name: 'Full screen view' }));
    expect(getByText('Full screen view')).toBeInTheDocument();

    // See the `fireEvent.click` note above — same class of issue closing the
    // modal (a `BaseBtn` nested inside the just-opened `Dialog`'s header).
    // `waitFor` (not a synchronous assertion): MUI's `Dialog` exits via a
    // `Fade` transition — the title stays mounted for the transition's
    // duration after `open` flips to `false`, not synchronously removed.
    fireEvent.click(getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => {
      expect(queryByText('Full screen view')).not.toBeInTheDocument();
    });
  });
});
