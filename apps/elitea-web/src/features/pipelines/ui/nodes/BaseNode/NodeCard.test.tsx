import type { ReactElement } from 'react';

import { fireEvent, render, waitFor, type RenderResult } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import { ReactFlow, ReactFlowProvider } from '@xyflow/react';

import { buildFlowEditorContextValue, createTestQueryClient } from '../../../__tests__/testUtils';
import { FlowEditorContext, type FlowEditorContextValue } from '../../../lib/flow-editor/flowEditorContext';
import { NodeCard, type NodeCardProps } from './NodeCard';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
});

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

/**
 * `NodeCard` reads `useContext(FlowEditorContext)` and (for `isEntrypoint`)
 * renders `TriggerTypeSelector`, which calls `useQueryClient()`
 * unconditionally (even with a disabled query) -- a bare `renderWithTheme`
 * throws "No QueryClient set" the moment `isEntrypoint` is exercised, so
 * every test here wraps in a real `QueryClientProvider` too.
 */
function renderTree(ui: ReactElement): RenderResult {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
      >
        {ui}
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function renderNodeCard(props: Partial<NodeCardProps>, flowEditorValue?: FlowEditorContextValue): RenderResult {
  const fullProps: NodeCardProps = {
    name: 'Node1',
    isEntrypoint: false,
    id: 'Node1',
    type: 'tool',
    children: <div data-testid="node-card-children">child content</div>,
    ...props,
  };

  const tree = (
    <ReactFlow
      nodes={[{ id: 'Node1', type: 'testNode', position: { x: 0, y: 0 }, data: {} }]}
      edges={[]}
      nodeTypes={{ testNode: () => <NodeCard {...fullProps} /> }}
    />
  );

  return renderTree(
    <ReactFlowProvider>
      {flowEditorValue ? <FlowEditorContext.Provider value={flowEditorValue}>{tree}</FlowEditorContext.Provider> : tree}
    </ReactFlowProvider>,
  );
}

/**
 * `toBeVisible()` walks every ANCESTOR's computed style, including
 * React Flow's own node wrapper -- which every node test in this slice
 * documents as staying `visibility: hidden` in jsdom because the
 * `ResizeObserver` stub above never calls back (see e.g.
 * `../SubgraphNode.test.tsx`'s own `hidden: true` note). That makes
 * `toBeVisible()` unusable here regardless of `NodeCard`'s own `isExpanded`
 * state. Reading the immediate `NodeBodyContainer` wrapper's OWN computed
 * `display` sidesteps the ancestor-visibility false negative entirely.
 */
function bodyDisplay(getByTestId: RenderResult['getByTestId']): string {
  const wrapper = getByTestId('node-card-children').parentElement;
  if (!wrapper) throw new Error('node-card-children has no parent wrapper');
  return getComputedStyle(wrapper).display;
}

describe('NodeCard', () => {
  it('renders nothing without a FlowEditorContext.Provider ancestor', () => {
    const { container } = renderNodeCard({});
    expect(container.querySelector('[data-testid="node-card-children"]')).not.toBeInTheDocument();
  });

  it('renders the header name and children once inside a FlowEditorContext.Provider', () => {
    const flowEditorValue = buildFlowEditorContextValue();
    const { getByText, getByTestId } = renderNodeCard({}, flowEditorValue);
    expect(getByText('Node1')).toBeInTheDocument();
    expect(getByTestId('node-card-children')).toBeInTheDocument();
  });

  it('keeps the body displayed (flex) when expandAll is explicitly true', async () => {
    const flowEditorValue = buildFlowEditorContextValue({ expandAll: true });
    const { getByTestId } = renderNodeCard({}, flowEditorValue);
    await waitFor(() => expect(bodyDisplay(getByTestId)).toBe('flex'));
  });

  it('collapses the body (display none) once mounted when expandAll is not set -- the sync-to-expandAll effect always runs, including on mount', async () => {
    const flowEditorValue = buildFlowEditorContextValue();
    const { getByTestId } = renderNodeCard({}, flowEditorValue);
    await waitFor(() => expect(bodyDisplay(getByTestId)).toBe('none'));
  });

  it('collapses the body (display none) once mounted when expandAll is explicitly false', async () => {
    const flowEditorValue = buildFlowEditorContextValue({ expandAll: false });
    const { getByTestId } = renderNodeCard({}, flowEditorValue);
    await waitFor(() => expect(bodyDisplay(getByTestId)).toBe('none'));
  });

  it('toggles the body display when the header expand/collapse button is clicked', async () => {
    const flowEditorValue = buildFlowEditorContextValue({ expandAll: true });
    const { getByTestId, container } = renderNodeCard({}, flowEditorValue);
    await waitFor(() => expect(bodyDisplay(getByTestId)).toBe('flex'));

    // The expand/collapse `IconButton` (`NodeCardHeader.tsx`'s `color="tertiary"`)
    // is the only `tertiary`-colored icon button in the header -- selected by
    // class rather than `getByRole('button', { name: '' })` because, with
    // `{ hidden: true }` needed for React Flow's `visibility: hidden` node
    // wrapper (see `bodyDisplay`'s own doc comment), more than one hidden
    // button in this tree resolves to an empty accessible name.
    const expandButton = container.querySelector('[class*="MuiIconButton-colorTertiary"]');
    expect(expandButton).toBeTruthy();
    fireEvent.click(expandButton as Element);

    await waitFor(() => expect(bodyDisplay(getByTestId)).toBe('none'));
  });

  it('renders no TriggerTypeSelector when isEntrypoint is false', async () => {
    const flowEditorValue = buildFlowEditorContextValue({ expandAll: true });
    const { queryByText, getByTestId } = renderNodeCard({ isEntrypoint: false }, flowEditorValue);
    await waitFor(() => expect(getByTestId('node-card-children')).toBeInTheDocument());
    expect(queryByText('Trigger')).not.toBeInTheDocument();
  });

  it('renders the TriggerTypeSelector when isEntrypoint is true', async () => {
    const flowEditorValue = buildFlowEditorContextValue({ expandAll: true });
    const { getByText } = renderNodeCard({ isEntrypoint: true }, flowEditorValue);
    await waitFor(() => expect(getByText('Trigger')).toBeInTheDocument());
  });

  it('forwards toolNames/onDuplicateName to NodeCardHeader (rename onto a name conflicting with a toolName reports through onDuplicateName)', async () => {
    const flowEditorValue = buildFlowEditorContextValue({ expandAll: true });
    const onDuplicateName = vi.fn();
    const { getByText, getByRole } = renderNodeCard({ toolNames: ['github'], onDuplicateName }, flowEditorValue);
    await waitFor(() => expect(getByText('Node1')).toBeInTheDocument());

    fireEvent.doubleClick(getByText('Node1'));
    // `{ hidden: true }` -- React Flow keeps every node `visibility: hidden`
    // in jsdom until its own `ResizeObserver` measurement fires (see
    // `bodyDisplay`'s own doc comment above), which the default role-query
    // accessibility filter otherwise treats as unqueryable.
    const input = getByRole('textbox', { hidden: true });
    fireEvent.change(input, { target: { value: 'github' } });
    fireEvent.blur(input);

    expect(onDuplicateName).toHaveBeenCalledWith(
      'The name conflicts with an existing toolkit name "github", please input a new name!',
    );
  });

  it('forwards a defined isConditionNode prop through to NodeCardHeader without throwing (NodeCardHeader itself never reads it -- forwarded for baseline parity only)', async () => {
    const flowEditorValue = buildFlowEditorContextValue({ expandAll: true });
    const { getByText } = renderNodeCard({ isConditionNode: true }, flowEditorValue);
    await waitFor(() => expect(getByText('Node1')).toBeInTheDocument());
  });

  it('calls the FlowEditorContext handleDeleteNode (not a no-op) when Delete is clicked in the node-actions menu', async () => {
    const handleDeleteNode = vi.fn();
    const flowEditorValue = buildFlowEditorContextValue({ expandAll: true, handleDeleteNode });
    const { getByText, container, findByText } = renderNodeCard({ id: 'Node1' }, flowEditorValue);
    await waitFor(() => expect(getByText('Node1')).toBeInTheDocument());

    // Selected by `aria-label` attribute directly, not `getByRole(...,
    // {name})` -- React Flow's hidden node wrapper (see `bodyDisplay`'s own
    // doc comment) makes RTL's accessible-name computation return an empty
    // name for elements underneath it even with `{ hidden: true }`, and the
    // header's OWN expand/collapse `IconButton` shares the same
    // `color="tertiary"` class as this dropdown trigger.
    const trigger = container.querySelector('[aria-label="Node actions"]') as HTMLElement;
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    fireEvent.click(await findByText('Delete'));

    expect(handleDeleteNode).toHaveBeenCalledWith('Node1');
  });

  it('disables the node-actions menu items when FlowEditorContext.disabled is explicitly true', async () => {
    const flowEditorValue = buildFlowEditorContextValue({ expandAll: true, disabled: true, isRunningPipeline: true });
    const { getByText, container, findByText } = renderNodeCard({ id: 'Node1' }, flowEditorValue);
    await waitFor(() => expect(getByText('Node1')).toBeInTheDocument());

    const trigger = container.querySelector('[aria-label="Node actions"]') as HTMLElement;
    fireEvent.click(trigger);
    const deleteItem = (await findByText('Delete')).closest('li');

    expect(deleteItem?.className).toContain('Mui-disabled');
  });

  it('invokes the custom handles render prop with the current isExpanded value', async () => {
    const flowEditorValue = buildFlowEditorContextValue({ expandAll: true });
    const handles = vi.fn(() => <div data-testid="custom-handles" />);
    const { getByTestId } = renderNodeCard({ handles }, flowEditorValue);
    await waitFor(() => expect(getByTestId('custom-handles')).toBeInTheDocument());
    expect(handles).toHaveBeenCalledWith(true);
  });

  it('renders without throwing when isPerforming is true', async () => {
    const flowEditorValue = buildFlowEditorContextValue({ expandAll: true });
    const { getByTestId } = renderNodeCard({ isPerforming: true }, flowEditorValue);
    await waitFor(() => expect(getByTestId('node-card-children')).toBeInTheDocument());
  });
});
