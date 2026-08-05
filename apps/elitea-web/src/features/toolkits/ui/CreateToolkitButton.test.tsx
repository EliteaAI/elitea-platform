import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CreateToolkitButton } from './CreateToolkitButton';
import type { CreateToolkitButtonProps } from './CreateToolkitButton';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderButton(props: Partial<CreateToolkitButtonProps> = {}) {
  const createToolkit = props.createToolkit ?? vi.fn().mockResolvedValue({ id: 'tk-1', type: 'github', name: 'GitHub' });
  return render(
    <ThemeProvider
      theme={theme}
      defaultMode={DEFAULT_COLOR_SCHEME}
    >
      <CreateToolkitButton
        toolSchema={undefined}
        values={{ type: 'github', name: 'GitHub' }}
        isDirty
        hasErrors={false}
        projectId="proj-1"
        createToolkit={createToolkit}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('CreateToolkitButton', () => {
  it('is disabled when the form is not dirty', () => {
    renderButton({ isDirty: false });
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

  it('is disabled while creating', () => {
    renderButton({ isCreating: true });
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

  it('is disabled when no type has been selected yet', () => {
    renderButton({ values: { type: undefined } });
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

  it('calls createToolkit and onToolkitCreated on click', async () => {
    const createToolkit = vi.fn().mockResolvedValue({ id: 'tk-1', type: 'github', name: 'GitHub' });
    const onToolkitCreated = vi.fn();
    const user = userEvent.setup();
    renderButton({ createToolkit, onToolkitCreated });

    await user.click(screen.getByRole('button', { name: /create/i }));

    expect(createToolkit).toHaveBeenCalledWith({ projectId: 'proj-1', type: 'github', name: 'GitHub' });
    expect(onToolkitCreated).toHaveBeenCalledWith({ id: 'tk-1', type: 'github', name: 'GitHub' });
  });

  it('overrides the name from the toolkit_name-flagged settings field', async () => {
    const createToolkit = vi.fn().mockResolvedValue({ id: 'tk-1', type: 'github', name: 'org-value' });
    const user = userEvent.setup();
    renderButton({
      createToolkit,
      toolSchema: { properties: { org: { toolkit_name: true } } },
      values: { type: 'github', name: 'ignored', settings: { org: 'org-value' } },
    });

    await user.click(screen.getByRole('button', { name: /create/i }));

    expect(createToolkit).toHaveBeenCalledWith(expect.objectContaining({ name: 'org-value' }));
  });

  it('triggers validation display and does not create when hasErrors is true', async () => {
    const createToolkit = vi.fn();
    const triggerValidation = vi.fn();
    const user = userEvent.setup();
    renderButton({ createToolkit, hasErrors: true, triggerValidation });

    await user.click(screen.getByRole('button', { name: /create/i }));

    expect(triggerValidation).toHaveBeenCalledTimes(1);
    expect(createToolkit).not.toHaveBeenCalled();
  });

  it('calls onError when the injected create mutation rejects, without throwing', async () => {
    const error = new Error('boom');
    const createToolkit = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const user = userEvent.setup();
    renderButton({ createToolkit, onError });

    await user.click(screen.getByRole('button', { name: /create/i }));

    expect(onError).toHaveBeenCalledWith(error);
  });
});
