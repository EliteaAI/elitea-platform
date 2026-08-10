/**
 * Regression cover for the reset effect in `EditUserRolesDialog`.
 *
 * The dialog seeds its selection from `originalRoles` and re-seeds whenever
 * that prop changes. `EditUsersButton` builds that prop as a fresh array
 * literal per render (`(_userRoles) ?? []`), so an identity-keyed effect
 * re-seeded on EVERY parent render — a react-query background refetch or the
 * toast-clear timer would silently discard a half-made selection and re-disable
 * Save. That is the ~1-in-15 J22f failure recorded in
 * `e2e/journeys/settings/settings.users.spec.ts`. These tests pin the
 * distinction: identity churn must be ignored, a real change of role VALUES
 * must not be.
 */
import { useState } from 'react';

import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { EditUserRolesDialog } from './EditUserRolesDialog';

const ROLES_OPTIONS = [
  { label: 'admin', value: 'admin' },
  { label: 'editor', value: 'editor' },
  { label: 'viewer', value: 'viewer' },
];

/**
 * Mirrors the real call sites: `originalRoles` is rebuilt as a new array on
 * every render, and the parent can be re-rendered on demand (standing in for a
 * refetch flipping `isFetching`) or handed a genuinely different role set.
 */
function Harness({ onConfirm = vi.fn() }: { onConfirm?: (roles: string[]) => void }) {
  const [, forceRender] = useState(0);
  const [roles, setRoles] = useState<string[]>(['viewer']);

  return (
    <>
      <button onClick={() => forceRender((n) => n + 1)}>rerender parent</button>
      <button onClick={() => setRoles(['admin'])}>change stored roles</button>
      <EditUserRolesDialog
        open
        onClose={vi.fn()}
        rolesOptions={ROLES_OPTIONS}
        // Fresh array identity on every render — the whole point of the test.
        originalRoles={[...roles]}
        onConfirm={onConfirm}
      />
    </>
  );
}

/** Opens the multi-select and toggles one option by its label. */
async function toggleRole(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(document.querySelector('[role="combobox"]')!);
  await user.click(findOption(label));
  // Close the popup so the Save button is reachable again.
  await user.keyboard('{Escape}');
}

function findOption(label: string): HTMLElement {
  const options = Array.from(document.querySelectorAll('[role="option"]'));
  const match = options.find((o) => o.textContent?.trim() === label);
  if (!match) throw new Error(`option "${label}" not found`);
  return match as HTMLElement;
}

const saveButton = () =>
  Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'Save',
  )!;

describe('EditUserRolesDialog', () => {
  it('enables Save once the selection differs from the stored roles', async () => {
    const user = userEvent.setup();
    renderWithTheme(<Harness />);

    expect(saveButton()).toBeDisabled();

    await toggleRole(user, 'editor');
    expect(saveButton()).toBeEnabled();
  });

  it('keeps an in-progress selection across a parent re-render', async () => {
    const user = userEvent.setup();
    renderWithTheme(<Harness />);

    await toggleRole(user, 'editor');
    expect(saveButton()).toBeEnabled();

    // A re-render that changes `originalRoles`' identity but not its values —
    // exactly what a background refetch produced. The selection must survive.
    await user.click(
      Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'rerender parent',
      )!,
    );

    expect(saveButton()).toBeEnabled();
  });

  it('confirms the selection made before a parent re-render', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithTheme(<Harness onConfirm={onConfirm} />);

    await toggleRole(user, 'editor');
    await user.click(
      Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'rerender parent',
      )!,
    );
    await user.click(saveButton());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect([...(onConfirm.mock.calls[0]![0] as string[])].sort()).toEqual([
      'editor',
      'viewer',
    ]);
  });

  it('re-seeds when the stored roles actually change', async () => {
    const user = userEvent.setup();
    renderWithTheme(<Harness />);

    await toggleRole(user, 'editor');
    expect(saveButton()).toBeEnabled();

    // A real change of the underlying roles (someone else edited the user, or
    // the save landed) must still reset the dialog to the stored value.
    await user.click(
      Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'change stored roles',
      )!,
    );

    expect(saveButton()).toBeDisabled();
  });
});
