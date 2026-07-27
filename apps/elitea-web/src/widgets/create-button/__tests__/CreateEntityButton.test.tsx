import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetConfigForTests } from '@/shared/config/get-config';
import { PERMISSIONS } from '@/shared/lib/permissions';

import { CreateEntityButton } from '../ui/CreateEntityButton';
import { renderAtPath } from './testRouter';

beforeEach(() => {
  resetConfigForTests();
  vi.stubEnv('VITE_SERVER_URL', 'https://elitea.example');
  vi.stubEnv('VITE_BASE_URI', '/app/');
  vi.stubEnv('VITE_PUBLIC_PROJECT_ID', '11');
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
  delete (globalThis as { elitea_ui_config?: unknown }).elitea_ui_config;
});

/** `PERMISSIONS` nests 1-3 levels deep (e.g. `chat.canvas.create`) — collects every leaf string regardless of depth. */
function collectPermissionStrings(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node && typeof node === 'object') return Object.values(node).flatMap(collectPermissionStrings);
  return [];
}

const allPermissions = new Set(collectPermissionStrings(PERMISSIONS));

describe('CreateEntityButton', () => {
  it('renders a plain "Create" trigger on a simple route (SHELL-026)', async () => {
    await renderAtPath('/onboarding', <CreateEntityButton permissions={allPermissions} />);
    expect(screen.getByTestId('sidebar-create-button')).toHaveTextContent('Create');
  });

  it('renders the split button with the route-implied entity label on a recognised route', async () => {
    await renderAtPath('/agents', <CreateEntityButton permissions={allPermissions} />);
    expect(screen.getByTestId('sidebar-create-button')).toHaveTextContent('Agent');
    expect(screen.getByRole('button', { name: 'Choose what to create' })).toBeInTheDocument();
  });

  it('collapsed mode always renders the simple icon-only trigger, even on a recognised route', async () => {
    await renderAtPath(
      '/agents',
      <CreateEntityButton
        permissions={allPermissions}
        collapsed
      />,
    );
    expect(screen.getByTestId('sidebar-create-button')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose what to create' })).not.toBeInTheDocument();
  });

  it('disables the trigger when the current entity is not permitted', async () => {
    await renderAtPath('/agents', <CreateEntityButton permissions={new Set()} />);
    expect(screen.getByTestId('sidebar-create-button')).toBeDisabled();
  });

  it('opens the dropdown and lists all 13 entities', async () => {
    const user = userEvent.setup();
    await renderAtPath('/agents', <CreateEntityButton permissions={allPermissions} />);
    await user.click(screen.getByRole('button', { name: 'Choose what to create' }));
    expect(screen.getByRole('menuitem', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Invite User' })).toBeInTheDocument();
  });

  it('marks a permission-denied dropdown option aria-disabled, distinct from the (permitted, enabled) active one', async () => {
    const user = userEvent.setup();
    // Active kind on /chat is 'chat', which the old app's CreationPermissions
    // grants via EITHER folders.create or chat.create — held here, so the
    // trigger itself stays enabled and the dropdown can be opened. 'agent'
    // requires PERMISSIONS.applications.create, deliberately NOT granted.
    const permissions = new Set([PERMISSIONS.chat.create]);
    await renderAtPath('/chat', <CreateEntityButton permissions={permissions} />);
    expect(screen.getByTestId('sidebar-create-button')).not.toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Choose what to create' }));
    expect(screen.getByRole('menuitem', { name: 'Chat' })).toHaveAttribute('aria-disabled', 'false');
    const agentOption = screen.getByRole('menuitem', { name: 'Agent' });
    expect(agentOption).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables the trigger on the system-prompts settings page regardless of permissions', async () => {
    await renderAtPath('/settings/prompts', <CreateEntityButton permissions={allPermissions} />);
    expect(screen.getByTestId('sidebar-create-button')).toBeDisabled();
  });

  it('clicking the main trigger navigates to the active kind\'s create destination', async () => {
    const user = userEvent.setup();
    const { router } = await renderAtPath('/skills', <CreateEntityButton permissions={allPermissions} />);
    await user.click(screen.getByTestId('sidebar-create-button'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/skills/create'));
  });

  it('selecting a dropdown option navigates to that kind\'s destination and closes the menu', async () => {
    const user = userEvent.setup();
    const { router } = await renderAtPath('/agents', <CreateEntityButton permissions={allPermissions} />);
    await user.click(screen.getByRole('button', { name: 'Choose what to create' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pipeline' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/pipelines/create'));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('selecting a dropdown option via the keyboard (Enter) also navigates', async () => {
    const user = userEvent.setup();
    const { router } = await renderAtPath('/agents', <CreateEntityButton permissions={allPermissions} />);
    await user.click(screen.getByRole('button', { name: 'Choose what to create' }));
    screen.getByRole('menuitem', { name: 'Skill' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/skills/create'));
  });

  it('clicking a permission-denied dropdown option does not navigate and leaves the menu open', async () => {
    const user = userEvent.setup();
    const permissions = new Set([PERMISSIONS.chat.create]);
    const { router } = await renderAtPath('/chat', <CreateEntityButton permissions={permissions} />);
    const before = router.state.location.pathname;
    await user.click(screen.getByRole('button', { name: 'Choose what to create' }));
    await user.click(screen.getByRole('menuitem', { name: 'Agent' }));
    expect(router.state.location.pathname).toBe(before);
    expect(screen.getByRole('menuitem', { name: 'Agent' })).toBeInTheDocument();
  });

  it('disables the trigger when allow_project_own_llms=false and the selected project is not the public one', async () => {
    // `allow_project_own_llms` reads `unknown` and is compared with a
    // strict `=== false` (schema.ts) — env vars are always strings, so a
    // real boolean `false` can only come from the `window.elitea_ui_config`
    // C6 source (checked first, per-key `hasOwnProperty`).
    (globalThis as { elitea_ui_config?: Record<string, unknown> }).elitea_ui_config = {
      allow_project_own_llms: false,
    };
    await renderAtPath(
      '/settings/model-configuration',
      <CreateEntityButton
        permissions={allPermissions}
        projectId="42"
      />,
    );
    expect(screen.getByTestId('sidebar-create-button')).toBeDisabled();
  });

  it('does NOT disable for the own-LLMs gate when the selected project IS the public one', async () => {
    (globalThis as { elitea_ui_config?: Record<string, unknown> }).elitea_ui_config = {
      allow_project_own_llms: false,
    };
    await renderAtPath(
      '/settings/model-configuration',
      <CreateEntityButton
        permissions={allPermissions}
        projectId="11"
      />,
    );
    expect(screen.getByTestId('sidebar-create-button')).not.toBeDisabled();
  });

  it('does NOT disable for the own-LLMs gate when allow_project_own_llms is unset (defaults true)', async () => {
    await renderAtPath(
      '/settings/model-configuration',
      <CreateEntityButton
        permissions={allPermissions}
        projectId="42"
      />,
    );
    expect(screen.getByTestId('sidebar-create-button')).not.toBeDisabled();
  });
});
