import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { CreateToolkit } from './CreateToolkit';
import { renderToolkitsRoute } from './__tests__/testRouter';

/**
 * `ToolkitTypeSelector`'s `CategorySection` rows use `useTextOverflow`
 * (`shared/ui/lib/useTextOverflow.ts`), which constructs a real
 * `ResizeObserver` — jsdom (this project's `node` vitest environment) does
 * not provide one. Same stub `features/toolkits/ui/ToolkitTypeSelector.test.tsx`/
 * `pages/credentials/CredentialTypeSelector.test.tsx` already establish for
 * this exact, pre-existing gap.
 */
class ResizeObserverStub {
  observe(): void {
    // no-op
  }
  disconnect(): void {
    // no-op
  }
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  resetGeneratedClient();
  vi.unstubAllGlobals();
});

describe('CreateToolkit', () => {
  it('shows the type selector first, then the toolkit form once a type is picked', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub' } } })));
    const user = userEvent.setup();
    const createToolkit = vi.fn().mockResolvedValue({ id: 'tk-new', type: 'github', name: 'GitHub' });

    renderToolkitsRoute(<CreateToolkit deps={{ createToolkit }} />, '/toolkits/create', { projectId: 'proj-1' });

    expect(await screen.findByText('New Toolkit')).toBeInTheDocument();
    expect(screen.getByText('Choose the toolkit type')).toBeInTheDocument();

    await user.click(await screen.findByText('GitHub'));

    await waitFor(() => expect(screen.queryByText('Choose the toolkit type')).not.toBeInTheDocument());
  });

  it('shows "New MCP" when isMCP is true', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})));
    const createToolkit = vi.fn();

    renderToolkitsRoute(<CreateToolkit isMCP deps={{ createToolkit }} />, '/toolkits/create', { projectId: 'proj-1' });

    expect(await screen.findByText('New MCP')).toBeInTheDocument();
  });

  it('shows "New Application" when isApplication is true', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})));
    const createToolkit = vi.fn();

    renderToolkitsRoute(<CreateToolkit isApplication deps={{ createToolkit }} />, '/toolkits/create', { projectId: 'proj-1' });

    expect(await screen.findByText('New Application')).toBeInTheDocument();
  });

  it('does not render the save/cancel tab bar before a type is picked', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub' } } })));
    const createToolkit = vi.fn();

    renderToolkitsRoute(<CreateToolkit deps={{ createToolkit }} />, '/toolkits/create', { projectId: 'proj-1' });

    await screen.findByText('Choose the toolkit type');
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('clicking Save after picking a type calls deps.createToolkit with the real project id and selected type', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub' } } })));
    const user = userEvent.setup();
    const createToolkit = vi.fn().mockResolvedValue({ id: 'tk-new', type: 'github', name: 'GitHub' });

    renderToolkitsRoute(<CreateToolkit deps={{ createToolkit }} />, '/toolkits/create', { projectId: 'proj-1' });

    await user.click(await screen.findByText('GitHub'));

    const saveButton = await screen.findByRole('button', { name: /save/i });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    await user.click(saveButton);

    await waitFor(() => expect(createToolkit).toHaveBeenCalledTimes(1));
    expect(createToolkit.mock.calls[0]?.[0]).toMatchObject({ projectId: 'proj-1', type: 'github' });
  });
});
