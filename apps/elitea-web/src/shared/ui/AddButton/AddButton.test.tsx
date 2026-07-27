import { createRef } from 'react';

import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { AddButton } from '.';

describe('AddButton', () => {
  it('renders an icon-only button named after the tooltip', () => {
    const { getByRole } = renderWithTheme(<AddButton />);
    expect(getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('uses a custom tooltip as the accessible name', () => {
    const { getByRole } = renderWithTheme(<AddButton tooltip="Add participant" />);
    expect(getByRole('button', { name: 'Add participant' })).toBeInTheDocument();
  });

  it('calls onAdd when clicked', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const { getByRole } = renderWithTheme(<AddButton onAdd={onAdd} />);
    await user.click(getByRole('button'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onAdd is not provided', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(<AddButton />);
    await user.click(getByRole('button'));
  });

  it('forwards a ref to the underlying button', () => {
    const ref = createRef<HTMLButtonElement>();
    renderWithTheme(<AddButton ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('activates on Enter when focused (native <button> semantics)', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const { getByRole } = renderWithTheme(<AddButton onAdd={onAdd} />);
    getByRole('button').focus();
    await user.keyboard('{Enter}');
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
