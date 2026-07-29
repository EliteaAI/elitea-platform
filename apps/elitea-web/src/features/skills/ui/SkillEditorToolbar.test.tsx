import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../__tests__/testUtils';
import { SkillEditorToolbar } from './SkillEditorToolbar';

describe('SkillEditorToolbar', () => {
  it('disables save and discard until dirty', () => {
    renderWithProviders(
      <SkillEditorToolbar
        isDirty={false}
        isSaving={false}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('invokes every supplied action', async () => {
    const user = userEvent.setup();
    const actions = { save: vi.fn(), discard: vi.fn(), remove: vi.fn(), export: vi.fn() };
    renderWithProviders(
      <SkillEditorToolbar
        isDirty
        isSaving={false}
        canDelete
        onSave={actions.save}
        onDiscard={actions.discard}
        onDelete={actions.remove}
        onExport={actions.export}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(Object.values(actions).every((action) => action.mock.calls.length === 1)).toBe(true);
  });
});
