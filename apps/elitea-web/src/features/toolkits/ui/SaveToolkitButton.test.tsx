import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SaveToolkitButton, toolkitNameSettingsKey } from './SaveToolkitButton';
import type { SaveToolkitButtonProps } from './SaveToolkitButton';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderButton(props: Partial<SaveToolkitButtonProps> = {}) {
  const saveToolkit = props.saveToolkit ?? vi.fn().mockResolvedValue({ id: 'tk-1', type: 'github', name: 'GitHub' });
  return render(
    <ThemeProvider
      theme={theme}
      defaultMode={DEFAULT_COLOR_SCHEME}
    >
      <SaveToolkitButton
        toolSchema={undefined}
        values={{ id: 'tk-1', type: 'github', name: 'GitHub' }}
        isDirty
        hasErrors={false}
        projectId="proj-1"
        saveToolkit={saveToolkit}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('toolkitNameSettingsKey', () => {
  it('finds the property flagged toolkit_name', () => {
    expect(toolkitNameSettingsKey({ properties: { server_url: {}, org_name: { toolkit_name: true } } })).toBe('org_name');
  });

  it('returns undefined when no property is flagged', () => {
    expect(toolkitNameSettingsKey({ properties: { server_url: {} } })).toBeUndefined();
  });

  it('returns undefined for an undefined schema', () => {
    expect(toolkitNameSettingsKey(undefined)).toBeUndefined();
  });
});

describe('SaveToolkitButton', () => {
  it('is disabled when the form is not dirty', () => {
    renderButton({ isDirty: false });
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('is disabled while saving', () => {
    renderButton({ isSaving: true });
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('calls saveToolkit and onToolkitSaved on click when the form is dirty and valid', async () => {
    const saveToolkit = vi.fn().mockResolvedValue({ id: 'tk-1', type: 'github', name: 'GitHub' });
    const onToolkitSaved = vi.fn();
    const user = userEvent.setup();
    renderButton({ saveToolkit, onToolkitSaved });

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(saveToolkit).toHaveBeenCalledWith({ projectId: 'proj-1', toolId: 'tk-1', id: 'tk-1', type: 'github', name: 'GitHub' });
    expect(onToolkitSaved).toHaveBeenCalledWith({ id: 'tk-1', type: 'github', name: 'GitHub' }, { id: 'tk-1', type: 'github', name: 'GitHub' });
  });

  it('overrides the name from the toolkit_name-flagged settings field when the schema has one', async () => {
    const saveToolkit = vi.fn().mockResolvedValue({ id: 'tk-1', type: 'github', name: 'org-value' });
    const user = userEvent.setup();
    renderButton({
      saveToolkit,
      toolSchema: { properties: { org: { toolkit_name: true } } },
      values: { id: 'tk-1', type: 'github', name: 'ignored', settings: { org: 'org-value' } },
    });

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(saveToolkit).toHaveBeenCalledWith(expect.objectContaining({ name: 'org-value' }));
  });

  it('triggers validation display and does not save when hasErrors is true', async () => {
    const saveToolkit = vi.fn();
    const triggerValidation = vi.fn();
    const user = userEvent.setup();
    renderButton({ saveToolkit, hasErrors: true, triggerValidation });

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(triggerValidation).toHaveBeenCalledTimes(1);
    expect(saveToolkit).not.toHaveBeenCalled();
  });

  it('calls onError when the injected save mutation rejects', async () => {
    const error = new Error('boom');
    const saveToolkit = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const user = userEvent.setup();
    renderButton({ saveToolkit, onError });

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onError).toHaveBeenCalledWith(error);
  });

  it('defers the save to onBeforeSave when the credential-warning gate returns false', async () => {
    const saveToolkit = vi.fn().mockResolvedValue({ id: 'tk-1', type: 'github', name: 'GitHub' });
    const onBeforeSave = vi.fn().mockReturnValue(false);
    const user = userEvent.setup();
    renderButton({ saveToolkit, onBeforeSave });

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onBeforeSave).toHaveBeenCalledTimes(1);
    expect(saveToolkit).not.toHaveBeenCalled();
  });

  it('proceeds immediately when onBeforeSave returns true', async () => {
    const saveToolkit = vi.fn().mockResolvedValue({ id: 'tk-1', type: 'github', name: 'GitHub' });
    const onBeforeSave = vi.fn().mockReturnValue(true);
    const user = userEvent.setup();
    renderButton({ saveToolkit, onBeforeSave });

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(saveToolkit).toHaveBeenCalledTimes(1);
  });
});
