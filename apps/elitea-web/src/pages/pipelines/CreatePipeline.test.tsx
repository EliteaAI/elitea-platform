import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { getCreateApplicationMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { CreatePipeline } from './CreatePipeline';
import { renderPipelinesRoute } from './__tests__/testRouter';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('CreatePipeline', () => {
  it('renders the Save/Cancel tab bar and the (composition-gap) form panel', async () => {
    renderPipelinesRoute(<CreatePipeline />, '/pipelines/create', { projectId: '1' });

    expect(await screen.findByTestId('pipeline-save-button')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByTestId('create-pipeline-form-panel')).toBeInTheDocument();
  });

  it('clicking Cancel opens a confirm dialog, and confirming navigates back to /pipelines/:tab', async () => {
    const user = userEvent.setup();
    const { router } = renderPipelinesRoute(<CreatePipeline />, '/pipelines/create', { projectId: '1' });

    await user.click(await screen.findByText('Cancel'));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/pipelines/latest'));
  });

  it('the Save button starts disabled (name/description are required and start empty) and never calls the create endpoint', async () => {
    const createSpy = vi.fn(() => ({
      id: '1',
      name: '',
      description: '',
      type: 'interface',
      icon: '',
      owner_id: 'user-1',
      created_at: '2026-01-01T00:00:00Z',
    }));
    server.use(getCreateApplicationMockHandler(createSpy));
    const { router } = renderPipelinesRoute(<CreatePipeline />, '/pipelines/create', { projectId: '1' });

    const saveButton = await screen.findByTestId('pipeline-save-button');
    await waitFor(() => expect(saveButton).toBeDisabled());

    expect(router.state.location.pathname).toBe('/pipelines/create');
    expect(createSpy).not.toHaveBeenCalled();
  });
});
