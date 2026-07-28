import { createRef } from 'react';
import type { ComponentProps } from 'react';

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSaveApplicationNewVersionMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { createTestQueryClient } from '../__tests__/testUtils';
import { SaveNewVersionButton, type SaveNewVersionButtonHandle } from './SaveNewVersionButton';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

function renderButton(props: Partial<ComponentProps<typeof SaveNewVersionButton>> = {}) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SaveNewVersionButton
        applicationId="3"
        projectId="p1"
        existingVersionNames={['base', 'v1']}
        version={{ instructions: 'Be helpful' }}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('SaveNewVersionButton', () => {
  it('opens the version-name dialog on click', async () => {
    const user = userEvent.setup();
    renderButton();
    expect(screen.queryByText('Create version')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save As Version' }));
    expect(screen.getByText('Create version')).toBeInTheDocument();
  });

  it('rejects a duplicate version name without calling the API', async () => {
    let requestCount = 0;
    server.use(
      getSaveApplicationNewVersionMockHandler(() => {
        requestCount += 1;
        return { id: '9', application_id: '3', name: 'base', status: 'draft' };
      }),
    );
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole('button', { name: 'Save As Version' }));
    await user.type(screen.getByLabelText('Version name'), 'base');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    expect(requestCount).toBe(0);
  });

  it('creates a new version and calls onSuccess, closing the dialog', async () => {
    server.use(
      getSaveApplicationNewVersionMockHandler({
        id: '9',
        application_id: '3',
        name: 'v2',
        status: 'draft',
        instructions: 'Be helpful',
      }),
    );
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    renderButton({ onSuccess });
    await user.click(screen.getByRole('button', { name: 'Save As Version' }));
    await user.type(screen.getByLabelText('Version name'), 'v2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Create version')).not.toBeInTheDocument());
  });

  it('exposes an imperative onSaveVersion handle that opens the dialog', async () => {
    const ref = createRef<SaveNewVersionButtonHandle>();
    renderButton({ ref });
    expect(screen.queryByText('Create version')).not.toBeInTheDocument();
    ref.current?.onSaveVersion();
    expect(await screen.findByText('Create version')).toBeInTheDocument();
  });

  it('calls onClickHandler instead of opening the dialog when provided', async () => {
    const onClickHandler = vi.fn();
    const user = userEvent.setup();
    renderButton({ onClickHandler });
    await user.click(screen.getByRole('button', { name: 'Save As Version' }));
    expect(onClickHandler).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Create version')).not.toBeInTheDocument();
  });
});
