import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { SecretManagementInput } from '.';

describe('SecretManagementInput', () => {
  it('renders a masked field with the given label, and no visibility toggle by default', () => {
    const { getByLabelText, queryByRole } = renderWithTheme(
      <SecretManagementInput
        value=""
        onChange={() => {}}
        label="Access token"
      />,
    );
    expect(getByLabelText('Access token', { exact: false })).toHaveAttribute('type', 'password');
    expect(queryByRole('button', { name: 'Show value' })).not.toBeInTheDocument();
  });

  it('shows the visibility toggle when explicitly enabled', () => {
    const { getByRole } = renderWithTheme(
      <SecretManagementInput
        value="tok_live"
        onChange={() => {}}
        label="Access token"
        passwordVisibilityToggle
      />,
    );
    expect(getByRole('button', { name: 'Show value' })).toBeInTheDocument();
  });

  it('forwards keystrokes through onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByLabelText } = renderWithTheme(
      <SecretManagementInput
        value=""
        onChange={onChange}
        label="Access token"
      />,
    );
    await user.type(getByLabelText('Access token', { exact: false }), 'x');
    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('applies the given name to the underlying control', () => {
    const { getByLabelText } = renderWithTheme(
      <SecretManagementInput
        value=""
        onChange={() => {}}
        label="Access token"
        name="api_key"
      />,
    );
    expect(getByLabelText('Access token', { exact: false })).toHaveAttribute('name', 'api_key');
  });

  it('fires onSave on blur', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { getByLabelText } = renderWithTheme(
      <SecretManagementInput
        value=""
        onChange={() => {}}
        label="Access token"
        onSave={onSave}
      />,
    );
    const input = getByLabelText('Access token', { exact: false });
    await user.click(input);
    await user.tab();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('forwards error and helperText to the underlying control', () => {
    const { getByText, getByLabelText } = renderWithTheme(
      <SecretManagementInput
        value=""
        onChange={() => {}}
        label="Access token"
        error
        helperText="Required"
      />,
    );
    expect(getByText('Required')).toBeInTheDocument();
    expect(getByLabelText('Access token', { exact: false })).toHaveAttribute('aria-invalid', 'true');
  });

  it('passes secrets config through to the underlying SecretField', () => {
    const { getByRole } = renderWithTheme(
      <SecretManagementInput
        value="{{secret.prod_api_key}}"
        onChange={() => {}}
        label="Access token"
        secrets={{ options: [{ label: 'Prod key', value: '{{secret.prod_api_key}}' }] }}
      />,
    );
    expect(getByRole('combobox')).toBeInTheDocument();
  });
});
