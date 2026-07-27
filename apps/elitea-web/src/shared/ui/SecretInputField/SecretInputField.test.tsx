import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { SecretInputField } from '.';

describe('SecretInputField', () => {
  it('masks the value by default (type="password")', () => {
    const { getByLabelText } = renderWithTheme(
      <SecretInputField
        fieldKey="apiKey"
        value="sk-12345"
        meta={{ label: 'API key' }}
        onChange={vi.fn()}
      />,
    );
    expect(getByLabelText('API key')).toHaveAttribute('type', 'password');
  });

  it('reveals the value as plain text when the show button is clicked', async () => {
    const user = userEvent.setup();
    const { getByLabelText, getByRole } = renderWithTheme(
      <SecretInputField
        fieldKey="apiKey"
        value="sk-12345"
        meta={{ label: 'API key' }}
        onChange={vi.fn()}
      />,
    );
    await user.click(getByRole('button', { name: 'Show value' }));
    expect(getByLabelText('API key')).toHaveAttribute('type', 'text');
    expect(getByRole('button', { name: 'Hide value' })).toBeInTheDocument();
  });

  it('re-masks the value when the hide button is clicked', async () => {
    const user = userEvent.setup();
    const { getByLabelText, getByRole } = renderWithTheme(
      <SecretInputField
        fieldKey="apiKey"
        value="sk-12345"
        meta={{ label: 'API key' }}
        onChange={vi.fn()}
      />,
    );
    await user.click(getByRole('button', { name: 'Show value' }));
    await user.click(getByRole('button', { name: 'Hide value' }));
    expect(getByLabelText('API key')).toHaveAttribute('type', 'password');
  });

  it('calls onChange with the new value while typing', () => {
    const onChange = vi.fn();
    const { getByLabelText } = renderWithTheme(
      <SecretInputField
        fieldKey="apiKey"
        value=""
        meta={{ label: 'API key' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(getByLabelText('API key'), { target: { value: 'sk-new' } });
    expect(onChange).toHaveBeenCalledWith('apiKey', 'sk-new');
  });

  it('reports undefined (not an empty string) when cleared', () => {
    const onChange = vi.fn();
    const { getByLabelText } = renderWithTheme(
      <SecretInputField
        fieldKey="apiKey"
        value="sk-12345"
        meta={{ label: 'API key' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(getByLabelText('API key'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('apiKey', undefined);
  });

  it('marks the field invalid and shows a "Field is required" hint when required and empty', () => {
    const { getByLabelText, getByRole } = renderWithTheme(
      <SecretInputField
        fieldKey="apiKey"
        value={undefined}
        meta={{ label: 'API key', isRequired: true }}
        onChange={vi.fn()}
      />,
    );
    expect(getByLabelText('API key')).toHaveAttribute('aria-invalid', 'true');
    expect(getByRole('button', { name: 'More information' })).toBeInTheDocument();
  });

  it('does not mark the field invalid once a required value is filled in', () => {
    const { getByLabelText } = renderWithTheme(
      <SecretInputField
        fieldKey="apiKey"
        value="sk-12345"
        meta={{ label: 'API key', isRequired: true }}
        onChange={vi.fn()}
      />,
    );
    expect(getByLabelText('API key')).toHaveAttribute('aria-invalid', 'false');
  });

  it('shows the description tooltip when the field is not required (or already filled in)', () => {
    const { getByRole } = renderWithTheme(
      <SecretInputField
        fieldKey="apiKey"
        value=""
        meta={{ label: 'API key', description: 'Used to authenticate requests.' }}
        onChange={vi.fn()}
      />,
    );
    expect(getByRole('button', { name: 'More information' })).toBeInTheDocument();
  });

  it('disables the input when meta.disabled is set', () => {
    const { getByLabelText } = renderWithTheme(
      <SecretInputField
        fieldKey="apiKey"
        value="sk-12345"
        meta={{ label: 'API key', disabled: true }}
        onChange={vi.fn()}
      />,
    );
    expect(getByLabelText('API key')).toBeDisabled();
  });
});
