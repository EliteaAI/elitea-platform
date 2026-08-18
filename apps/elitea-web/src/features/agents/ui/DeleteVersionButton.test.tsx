import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderWithProviders } from '../__tests__/testUtils';

import { DeleteVersionButton } from './DeleteVersionButton';

const DELETE_ROUTE = '*/elitea_core/version/prompt_lib/:projectId/:applicationId/:versionId';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

function renderButton(overrides: { onDeleted?: () => void; onError?: (message: string) => void } = {}) {
  return renderWithProviders(
    <DeleteVersionButton
      projectId="9"
      applicationId={42}
      versionId={7}
      versionName="base"
      onDeleted={overrides.onDeleted ?? vi.fn()}
      {...(overrides.onError === undefined ? {} : { onError: overrides.onError })}
    />,
  );
}

/**
 * The point of every assertion here is the REQUEST and the CALLBACK, not the
 * dialog: `useDeleteVersion` was exported for a version-delete dialog that
 * was never built, so "the button renders" is precisely the assertion that
 * was already true and meant nothing.
 */
describe('DeleteVersionButton', () => {
  it('issues the version DELETE only after the confirm dialog is confirmed, then reports success', async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    server.use(
      http.delete(DELETE_ROUTE, ({ request }) => {
        requests.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const onDeleted = vi.fn();
    renderButton({ onDeleted });

    await user.click(screen.getByTestId('agent-version-delete'));
    // Opening the dialog must not, by itself, delete anything.
    expect(requests).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /delete/i, hidden: false }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toContain('/9/42/7');
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it('reports the server refusal and does NOT report success when the delete fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.delete(DELETE_ROUTE, () =>
        HttpResponse.json({ error: 'Unpublish first. Cannot delete a published version.' }, { status: 400 }),
      ),
    );
    const onDeleted = vi.fn();
    const onError = vi.fn();
    renderButton({ onDeleted, onError });

    await user.click(screen.getByTestId('agent-version-delete'));
    await user.click(screen.getByRole('button', { name: /delete/i, hidden: false }));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('stays disabled — and so cannot fire a request against a placeholder id — until the ids resolve', () => {
    renderWithProviders(
      <DeleteVersionButton
        projectId={undefined}
        applicationId={undefined}
        versionId={undefined}
        versionName="base"
        onDeleted={vi.fn()}
      />,
    );

    expect(screen.getByTestId('agent-version-delete')).toBeDisabled();
  });
});
