import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolEvents } from '@/entities/toolkit';
import { eventEmitter } from '@/features/toolkits/lib/eventEmitter';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';
import { server } from '@/test/setup';

import { EditToolkit } from './EditToolkit';
import { renderToolkitsRoute } from './__tests__/testRouter';

// The `github` mock schema below has no `type` field (matches every other
// fixture in this file — `getToolComponent`, `features/toolkits/lib/helpers/
// toolComponent.helpers.ts`, resolves that to `ToolCustom`'s raw-JSON
// editor, a real CodeMirror instance), so both new tests below need the
// same jsdom polyfills `YamlCodeEditor.test.tsx` (a sibling CodeMirror
// consumer) already establishes for mounting one under jsdom.
installCodeMirrorTestPolyfills();

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

function mockToolkitRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tk-1',
    type: 'github',
    name: 'My GitHub',
    description: '',
    settings: {},
    meta: {},
    created_at: '2026-01-01T00:00:00Z',
    author_id: 1,
    ...overrides,
  };
}

describe('EditToolkit', () => {
  it('fetches the real toolkit detail by id and shows its name as the title', async () => {
    server.use(
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () => HttpResponse.json({ rows: [mockToolkitRow()], total: 1 })),
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub' } } })),
    );
    const saveToolkit = vi.fn();

    renderToolkitsRoute(<EditToolkit deps={{ saveToolkit }} />, '/toolkits/latest/tk-1', { projectId: 'proj-1' });

    expect(await screen.findByText('My GitHub')).toBeInTheDocument();
  });

  it('renders the Configuration/Indexes tabs, and the Indexes panel is a disclosed composition-gap slot', async () => {
    server.use(
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () => HttpResponse.json({ rows: [mockToolkitRow()], total: 1 })),
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub' } } })),
    );
    const saveToolkit = vi.fn();
    const user = userEvent.setup();

    renderToolkitsRoute(<EditToolkit deps={{ saveToolkit }} />, '/toolkits/latest/tk-1', { projectId: 'proj-1' });

    await screen.findByText('My GitHub');
    expect(screen.getByRole('tab', { name: 'Configuration' })).toBeInTheDocument();
    const indexesTab = screen.getByRole('tab', { name: 'Indexes' });

    await user.click(indexesTab);

    expect(await screen.findByTestId('edit-toolkit-indexes-tab-panel')).toBeInTheDocument();
  });

  it('renders the export/delete action buttons once a toolkit id is known', async () => {
    server.use(
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () => HttpResponse.json({ rows: [mockToolkitRow()], total: 1 })),
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})),
    );
    const saveToolkit = vi.fn();

    renderToolkitsRoute(<EditToolkit deps={{ saveToolkit }} />, '/toolkits/latest/tk-1', { projectId: 'proj-1' });

    await screen.findByText('My GitHub');
    expect(screen.getByLabelText('export toolkit')).toBeInTheDocument();
    expect(screen.getByLabelText('delete entity')).toBeInTheDocument();
  });

  it('falls back to "Edit Toolkit" (or "Edit MCP") while the detail is loading / unresolved', async () => {
    server.use(
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () => HttpResponse.json({ rows: [], total: 0 })),
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})),
    );
    const saveToolkit = vi.fn();

    renderToolkitsRoute(<EditToolkit isMCP deps={{ saveToolkit }} />, '/toolkits/latest/tk-1', { projectId: 'proj-1' });

    await waitFor(() => expect(screen.getByText('Edit MCP')).toBeInTheDocument());
  });

  /**
   * `github`'s mock toolkit-type schema below (like every other fixture in
   * this file) has no `type` field, so `getToolComponent` (`features/
   * toolkits/lib/helpers/toolComponent.helpers.ts`) resolves `ToolCustom`
   * (its raw-JSON `CodeMirror` editor) rather than `ToolBase` — `ToolBase`
   * itself is never reached this way, so its own `NameDescriptionInput`
   * slot never renders. `ToolCustom`'s serialized JSON
   * (`buildInitialJson`, `ToolCustom.tsx:84-89`) reads `editToolDetail.
   * description` DIRECTLY — the exact same field `toEditDetail` (`../
   * EditToolkit.tsx`) now seeds — so its presence/absence in the rendered
   * JSON is an equally real, equally direct proof of this fix (before the
   * fix, `description` was `undefined` on `editToolDetail`, and
   * `JSON.stringify` omits `undefined`-valued keys outright — the
   * `"description"` key wouldn't appear in the DOM at all).
   */
  function getCodeMirrorContent(container: HTMLElement): HTMLElement {
    const content = container.querySelector('.cm-content');
    if (!(content instanceof HTMLElement)) throw new Error('CodeMirror content element not found');
    return content;
  }

  it('seeds the Description field from the fetched toolkit detail', async () => {
    server.use(
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () => HttpResponse.json({ rows: [mockToolkitRow({ description: 'REAL SAVED DESCRIPTION' })], total: 1 })),
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub' } } })),
    );
    const saveToolkit = vi.fn();

    const { container } = renderToolkitsRoute(<EditToolkit deps={{ saveToolkit }} />, '/toolkits/latest/tk-1', { projectId: 'proj-1' });

    await screen.findByText('My GitHub');
    await waitFor(() => expect(getCodeMirrorContent(container)).toHaveTextContent('REAL SAVED DESCRIPTION'));
  });

  it('passes an edited description through to deps.saveToolkit on save (real ToolkitsUpdateToolkit save path)', async () => {
    server.use(
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () => HttpResponse.json({ rows: [mockToolkitRow({ description: 'REAL SAVED DESCRIPTION' })], total: 1 })),
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub' } } })),
    );
    const saveToolkit = vi.fn().mockResolvedValue({ id: 'tk-1', type: 'github', name: 'My GitHub' });
    const user = userEvent.setup();

    const { container } = renderToolkitsRoute(<EditToolkit deps={{ saveToolkit }} />, '/toolkits/latest/tk-1', { projectId: 'proj-1' });

    await screen.findByText('My GitHub');
    const content = getCodeMirrorContent(container);
    await waitFor(() => expect(content).toHaveTextContent('REAL SAVED DESCRIPTION'));

    // Replace the whole JSON document with the same shape but an edited
    // `description` — `ToolCustom`'s own parse effect (`ToolCustom.tsx:
    // 246-258`) round-trips every parsed field, including `description`,
    // back up through `editField`/`setEditToolDetail` on every valid-JSON
    // edit. A single `paste` (not per-keystroke `type`) — CM6's
    // `closeBrackets` extension auto-inserts a matching `}`/`"` per
    // keystroke, which corrupts a character-by-character JSON retype
    // (confirmed live: it left a stray extra `}` in the document).
    const newJson = '{"name":"My GitHub","description":"UPDATED DESCRIPTION","settings":{},"type":"github"}';

    await user.click(content);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(newJson);
    await waitFor(() => expect(content).toHaveTextContent('UPDATED DESCRIPTION'));

    // `ToolkitsOperationButtons` (`features/toolkits/ui/form/ToolkitForm/
    // ToolkitsOperationButtons.tsx`) is driven entirely through the shared
    // `eventEmitter` — its own doc comment and test suite establish
    // `eventEmitter.emit(ToolEvents.ToolkitsUpdateToolkit)` as the real
    // save trigger a click on `ToolkitsTabBar`'s Save button would emit;
    // `EditToolkit`'s own page doesn't compose that tab bar (a disclosed,
    // pre-existing gap, not this unit's fix), so this exercises the same
    // real internal save path directly. The edited description only
    // reaches `ToolkitsOperationButtons`'s own `formValues` closure after
    // `ToolCustom`'s parse effect finishes its `editField` round-trip and
    // the tree re-renders — one or more passive-effect cycles after the
    // CodeMirror view itself already shows the new text — so the emit is
    // retried (a real click on a real Save button would just as validly be
    // a second real click) until the save call actually carries the
    // edited value.
    await waitFor(() => {
      eventEmitter.emit(ToolEvents.ToolkitsUpdateToolkit);
      expect(saveToolkit.mock.calls.at(-1)?.[0]).toMatchObject({ projectId: 'proj-1', toolId: 'tk-1', type: 'github', description: 'UPDATED DESCRIPTION' });
    });
  });
});
