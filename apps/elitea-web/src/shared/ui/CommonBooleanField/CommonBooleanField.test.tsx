import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { CommonBooleanField } from '.';

describe('CommonBooleanField', () => {
  it('renders the label', () => {
    const { getByText } = renderWithTheme(
      <CommonBooleanField
        fieldKey="enabled"
        value={false}
        meta={{ label: 'Enabled' }}
        onChange={vi.fn()}
      />,
    );
    expect(getByText('Enabled')).toBeInTheDocument();
  });

  it('appends the required marker to the label', () => {
    const { getByText } = renderWithTheme(
      <CommonBooleanField
        fieldKey="enabled"
        value={false}
        meta={{ label: 'Enabled', isRequired: true }}
        onChange={vi.fn()}
      />,
    );
    expect(getByText('Enabled *')).toBeInTheDocument();
  });

  it('reflects an undefined value as unchecked', () => {
    const { getByRole } = renderWithTheme(
      <CommonBooleanField
        fieldKey="enabled"
        value={undefined}
        meta={{ label: 'Enabled' }}
        onChange={vi.fn()}
      />,
    );
    expect(getByRole('checkbox')).not.toBeChecked();
  });

  it('reflects a true value as checked', () => {
    const { getByRole } = renderWithTheme(
      <CommonBooleanField
        fieldKey="enabled"
        value
        meta={{ label: 'Enabled' }}
        onChange={vi.fn()}
      />,
    );
    expect(getByRole('checkbox')).toBeChecked();
  });

  it('calls onChange with the field key and new value when toggled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <CommonBooleanField
        fieldKey="enabled"
        value={false}
        meta={{ label: 'Enabled' }}
        onChange={onChange}
      />,
    );
    await user.click(getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith('enabled', true);
  });

  it('calls onChange toggling true back to false', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <CommonBooleanField
        fieldKey="enabled"
        value
        meta={{ label: 'Enabled' }}
        onChange={onChange}
      />,
    );
    await user.click(getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith('enabled', false);
  });

  it('disables the checkbox when meta.disabled is set', () => {
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <CommonBooleanField
        fieldKey="enabled"
        value={false}
        meta={{ label: 'Enabled', disabled: true }}
        onChange={onChange}
      />,
    );
    // The native `disabled` attribute is the proof: a real browser never
    // dispatches click/change to a disabled control (same reasoning as
    // `BaseCheckbox.test.tsx`'s equivalent case — `user.click` here would
    // throw on jsdom's `pointer-events: none` guard before it could tell us
    // anything about this component, and a raw synthetic dispatch would
    // only prove a jsdom quirk, not real disabled-control behaviour).
    expect(getByRole('checkbox')).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders an info tooltip trigger when a description is given', () => {
    const { getByRole } = renderWithTheme(
      <CommonBooleanField
        fieldKey="enabled"
        value={false}
        meta={{ label: 'Enabled', description: 'Turns the thing on' }}
        onChange={vi.fn()}
      />,
    );
    expect(getByRole('button', { name: 'More information' })).toBeInTheDocument();
  });

  it('renders no info tooltip trigger when there is no description', () => {
    const { queryByRole } = renderWithTheme(
      <CommonBooleanField
        fieldKey="enabled"
        value={false}
        meta={{ label: 'Enabled' }}
        onChange={vi.fn()}
      />,
    );
    expect(queryByRole('button')).not.toBeInTheDocument();
  });
});
