import { createRef } from 'react';

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

/**
 * This file mounts the REAL `FlowEditor` component, no mocking. `vi.mock()`
 * to isolate it from any not-yet-landed sibling dependency was considered
 * and rejected: R-M1 (`elitea/no-vi-mock`, `.oxlintrc.json`) bans
 * `vi.mock()` everywhere outside a `__mocks__` directory ("tests substitute
 * only the network boundary (MSW) and the socket double, §6.2"), so mocking
 * a sibling component to route around its own gaps is not a compliant
 * option here — mounting the real component is the only compliant choice,
 * whatever state its sibling-owned dependencies are in.
 *
 * Historical note, now resolved: `FlowEditor` transitively imports
 * `AgentNode.tsx` (A2e/A2f) -> `../settings/InputMappings/InputMapping`
 * and `RunStateNodeGroup.tsx` -> `RunStateNode.tsx` -> `RunStateDialog.
 * status.tsx`. Both of those previously-blocking gaps (A2i's list-level
 * `InputMapping.tsx` not yet landed; `RunStateDialog.status.tsx`'s
 * `@mui/icons-material/ErrorOutline` import not resolving to an installed
 * icon) have since landed/been worked around by their owning sub-units —
 * `InputMapping.tsx` now exists at `../settings/InputMappings/
 * InputMapping`, and `RunStateDialog.status.tsx` now imports
 * `ErrorOutlineOutlined` instead (disclosed in that file's own comment).
 * This file's tests do run and pass today as a result.
 *
 * A different, real gap remains on the same `RunStateNodeGroup` chain,
 * disclosed at `FlowEditor.tsx`'s `runStateEntries` definition: `./nodes/
 * RunStateNodeGroup` does not actually export a `RunStateEntry` type
 * (confirmed via `npx tsc --noEmit`: `FlowEditor.tsx(106,34): error
 * TS2305`), even though `FlowEditor.tsx` imports one. That is a type-level
 * gap only — `vitest`'s esbuild transform strips type-only imports, so it
 * does not stop this file's tests from running or passing, but it does
 * mean `FlowEditor.tsx` is not yet on a clean `tsc --noEmit` footing. The
 * fix belongs in `./nodes/RunStateNodeGroup.tsx` (A2f, sibling-owned, not
 * this sub-unit's file to edit) — adding the missing `RunStateEntry`
 * export there. Not fixed here.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

import { FlowEditor, type FlowEditorHandle, type FlowEditorProps } from './FlowEditor';

function baseProps(overrides: Partial<FlowEditorProps> = {}): FlowEditorProps {
  return {
    yamlJsonObject: { nodes: [] },
    setYamlJsonObject: vi.fn(),
    initialNodes: [],
    initialEdges: [],
    layoutVersion: '1.0',
    resetFlag: false,
    onResetHandled: vi.fn(),
    onLayoutVersionChange: vi.fn(),
    stopRun: vi.fn(),
    disabled: false,
    ...overrides,
  };
}

function renderFlowEditor(props: FlowEditorProps, ref?: React.Ref<FlowEditorHandle>) {
  return renderWithTheme(
    <ReactFlowProvider>
      <FlowEditor
        {...props}
        ref={ref}
      />
    </ReactFlowProvider>,
  );
}

describe('FlowEditor', () => {
  it('renders the canvas chrome (run-state overlay, State toggle button) without crashing', () => {
    renderFlowEditor(baseProps());

    expect(screen.getByRole('button', { name: 'State' })).toBeInTheDocument();
  });

  it('opens the state drawer when the State button is clicked, and the button hides while it is open', async () => {
    const user = userEvent.setup();
    renderFlowEditor(baseProps());

    await user.click(screen.getByRole('button', { name: 'State' }));

    expect(screen.queryByRole('button', { name: 'State' })).not.toBeInTheDocument();
  });

  it('exposes the full FlowEditorHandle imperative surface via ref', () => {
    const ref = createRef<FlowEditorHandle>();
    renderFlowEditor(baseProps(), ref);

    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.fitView).toBe('function');
    expect(typeof ref.current?.onAddNode).toBe('function');
    expect(typeof ref.current?.onRcvAgentEvent).toBe('function');
    expect(typeof ref.current?.setFlowEdges).toBe('function');
    expect(typeof ref.current?.setFlowNodes).toBe('function');
    expect(typeof ref.current?.deleteAllRunNodes).toBe('function');
    expect(typeof ref.current?.getCurrentExpandState).toBe('function');
    expect(typeof ref.current?.calculateLayoutNodes).toBe('function');
    expect(typeof ref.current?.stopCurrentRun).toBe('function');
    expect(typeof ref.current?.hasRunsInProgress).toBe('function');
  });

  it('getCurrentExpandState starts true (baseline default) and hasRunsInProgress starts false with no runs', () => {
    const ref = createRef<FlowEditorHandle>();
    renderFlowEditor(baseProps(), ref);

    expect(ref.current?.getCurrentExpandState()).toBe(true);
    expect(ref.current?.hasRunsInProgress()).toBe(false);
  });
});
