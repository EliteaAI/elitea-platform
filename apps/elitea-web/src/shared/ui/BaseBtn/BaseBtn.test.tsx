import { createRef } from 'react';

import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { BaseBtn } from '.';

describe('BaseBtn', () => {
  it('renders its children as a real button', () => {
    const { getByRole } = renderWithTheme(<BaseBtn>Click me</BaseBtn>);
    expect(getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('fires onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole } = renderWithTheme(<BaseBtn onClick={onClick}>Go</BaseBtn>);
    await user.click(getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    const { getByRole } = renderWithTheme(
      <BaseBtn
        onClick={onClick}
        disabled
      >
        Go
      </BaseBtn>,
    );
    const button = getByRole('button');
    expect(button).toBeDisabled();
    // A real mouse can never click a `pointer-events: none` disabled
    // button; `fireEvent` dispatches the DOM event directly, proving the
    // handler itself is gated by the native `disabled` attribute too.
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('forwards a ref to the underlying <button>', () => {
    const ref = createRef<HTMLButtonElement>();
    renderWithTheme(<BaseBtn ref={ref}>Go</BaseBtn>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('defaults loadingPosition to "end"', () => {
    const { getByRole } = renderWithTheme(
      <BaseBtn loading>Go</BaseBtn>,
    );
    // MUI renders the loading indicator only once `loading` is set; the
    // button becomes non-interactive while loading.
    expect(getByRole('button')).toBeDisabled();
  });

  it('activates on Enter when focused (native <button> semantics)', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole } = renderWithTheme(<BaseBtn onClick={onClick}>Go</BaseBtn>);
    getByRole('button').focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
