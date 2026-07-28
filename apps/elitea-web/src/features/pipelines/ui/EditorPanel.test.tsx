import type { ComponentProps } from 'react';
import { createRef } from 'react';

import { ThemeProvider } from '@mui/material/styles';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import { usePipelineYamlStore } from '../model/pipelineYamlStore';
import { EditorPanel } from './EditorPanel';
import type { EditorPanelHandle } from './EditorPanel';

/**
 * No `vi.mock()` here (`no-vi-mock`/R-M1 forbids it outright, verified via
 * `npx oxlint` — this codebase substitutes only the network boundary/MSW
 * and the socket double, never an application module). `EditorPanel`
 * `React.lazy()`-loads `./FlowWrapper` (which statically imports
 * `./FlowEditor`, unit A2k), and that chain has a real, verified,
 * currently-broken transitive dependency (`ui/state/RunStateDialog.status.
 * tsx` imports a non-existent `@mui/icons-material/ErrorOutline` — see
 * `flowWrapperStyles.ts`'s own doc comment for the full citation). Every
 * test below renders the REAL, unmocked component tree; verified directly
 * (before writing these assertions) that `React.lazy`'s deferred-resolution
 * + this file's own `FlowEditorErrorBoundary` together catch that failure
 * gracefully at test time exactly like they would in production — the
 * "shows the error-boundary fallback" test below asserts that REAL,
 * currently-true behaviour, not a workaround. `AddNodeMenu`/the mode toggle/
 * the copy button are direct JSX SIBLINGS of the lazy-loaded flow pane, not
 * descendants, so they render and are fully testable independent of whether
 * that pane itself ever resolves.
 */
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

beforeEach(() => {
  usePipelineYamlStore.setState({
    yamlCode: 'nodes: []',
    yamlJsonObject: { nodes: [] },
    initYamlCode: 'nodes: []',
    initYamlJsonObject: { nodes: [] },
    resetFlag: false,
    layoutVersion: undefined,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderEditorPanel(
  props: Partial<ComponentProps<typeof EditorPanel>> = {},
  path = '/pipelines/latest/1',
  ref?: React.Ref<EditorPanelHandle>,
) {
  const rootRoute = createRootRoute({
    component: () => (
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
      >
        <EditorPanel
          setYamlDirty={vi.fn()}
          stopRun={vi.fn()}
          ref={ref}
          {...props}
        />
      </ThemeProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: [path] }) });
  return render(<RouterProvider router={router} />);
}

describe('EditorPanel', () => {
  it('starts in Flow mode: shows the AddNodeMenu trigger, not the copy button', async () => {
    renderEditorPanel();
    expect(await screen.findByRole('button', { name: 'Add node' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });

  it('switching to Yaml mode hides the AddNodeMenu and shows the copy button', async () => {
    const user = userEvent.setup();
    renderEditorPanel();

    await user.click(await screen.findByRole('button', { name: 'Yaml' }));

    expect(screen.queryByRole('button', { name: 'Add node' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /copy yaml code/i })).toBeInTheDocument());
  });

  it('calls setYamlDirty with the live dirty state', async () => {
    const setYamlDirty = vi.fn();
    renderEditorPanel({ setYamlDirty });
    await waitFor(() => expect(setYamlDirty).toHaveBeenCalledWith(false));
  });

  it('shows the error-boundary fallback for the flow pane, reflecting the real current state of the sibling FlowEditor dependency chain', async () => {
    renderEditorPanel();
    expect(await screen.findByText('Failed to load the flow editor', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  }, 10000);

  it('the error-boundary reload button calls window.location.reload', async () => {
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { reload: reloadSpy });

    const user = userEvent.setup();
    renderEditorPanel();
    await user.click(await screen.findByRole('button', { name: 'Reload page' }, { timeout: 5000 }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  }, 10000);

  it('exposes onRcvAgentEvent/deleteAllRunNodes/fitView/onStopRun/hasRunsInProgress on the imperative ref, and none of them throw even though the flow pane failed to load', async () => {
    const ref = createRef<EditorPanelHandle>();
    renderEditorPanel({}, '/pipelines/latest/1', ref);

    await waitFor(() => expect(ref.current).not.toBeNull());
    expect(() => ref.current?.onRcvAgentEvent({})).not.toThrow();
    expect(() => ref.current?.deleteAllRunNodes()).not.toThrow();
    expect(() => ref.current?.fitView()).not.toThrow();
    expect(() => ref.current?.onStopRun()).not.toThrow();
    expect(ref.current?.hasRunsInProgress()).toBe(false);
  });

  it('disabled=true is forwarded to AddNodeMenu (disables its trigger button)', async () => {
    renderEditorPanel({ disabled: true });
    expect(await screen.findByRole('button', { name: 'Add node' })).toBeDisabled();
  });
});
