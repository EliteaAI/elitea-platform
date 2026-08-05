import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderWithRouterAndProject } from '../__tests__/testUtils';

import { AttachmentSwitch } from './AttachmentSwitch';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('AttachmentSwitch', () => {
  // `<RouterProvider>` resolves its initial route match asynchronously
  // (`Transitioner`/`MatchesInner`, per the real "not wrapped in act()"
  // warning this suite surfaced) — every assertion below is a `waitFor`/
  // `find*` query, never a synchronous `getBy*` right after `render()`.

  it('renders the Attachments label with an info tooltip', async () => {
    renderWithRouterAndProject(
      <AttachmentSwitch
        checked={false}
        onCheckedChange={vi.fn()}
      />,
      undefined,
    );
    expect(await screen.findByText('Attachments')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable file attachment capabilities/i })).toBeInTheDocument();
  });

  it('reflects checked=true', async () => {
    renderWithRouterAndProject(
      <AttachmentSwitch
        checked
        onCheckedChange={vi.fn()}
      />,
      undefined,
    );
    expect(await screen.findByRole('switch')).toBeChecked();
  });

  it('is disabled when the caller passes disabled=true, regardless of permission', async () => {
    renderWithRouterAndProject(
      <AttachmentSwitch
        checked={false}
        onCheckedChange={vi.fn()}
        disabled
      />,
      undefined,
    );
    expect(await screen.findByRole('switch')).toBeDisabled();
  });

  it('is disabled while there is no selected project (permission check has nothing to query)', async () => {
    // No `projectId` -> `useHasPermission`'s query never fires
    // (`enabled: projectId !== undefined`), so permissions resolve to an
    // empty set and the switch stays disabled. Real behaviour, not a stub.
    renderWithRouterAndProject(
      <AttachmentSwitch
        checked={false}
        onCheckedChange={vi.fn()}
      />,
      undefined,
    );
    expect(await screen.findByRole('switch')).toBeDisabled();
  });

  it('is disabled when the real permission-list endpoint does not grant toolkits.patch', async () => {
    server.use(
      http.get('/api/v2/auth/permissions/prompt_lib/:projectId', () =>
        HttpResponse.json([{ name: 'models.applications.tool.patch', enabled: false }]),
      ),
    );

    renderWithRouterAndProject(
      <AttachmentSwitch
        checked={false}
        onCheckedChange={vi.fn()}
      />,
      'proj-1',
    );

    await waitFor(() => expect(screen.getByRole('switch')).toBeDisabled());
  });

  it('enables the switch once the real permission-list endpoint grants toolkits.patch', async () => {
    server.use(
      http.get('/api/v2/auth/permissions/prompt_lib/:projectId', () =>
        HttpResponse.json([{ name: 'models.applications.tool.patch', enabled: true }]),
      ),
    );

    let onCheckedChangeArg: boolean | undefined;
    const onCheckedChange = vi.fn((checked: boolean) => {
      onCheckedChangeArg = checked;
    });

    renderWithRouterAndProject(
      <AttachmentSwitch
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
      'proj-1',
    );

    await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
    fireEvent.click(screen.getByRole('switch'));
    expect(onCheckedChangeArg).toBe(true);
  });
});
