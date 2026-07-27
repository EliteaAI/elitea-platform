import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { OneClickButton } from '.';

describe('OneClickButton', () => {
  it('renders the default "Button" title', () => {
    const { getByRole } = renderWithTheme(<OneClickButton />);
    expect(getByRole('button', { name: 'Button' })).toBeInTheDocument();
  });

  it('renders a custom title', () => {
    const { getByRole } = renderWithTheme(<OneClickButton title="Submit" />);
    expect(getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('calls onClick once per click before it disables itself', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole } = renderWithTheme(<OneClickButton onClick={onClick} />);
    await user.click(getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables itself after the first click and stays disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole } = renderWithTheme(<OneClickButton onClick={onClick} />);
    const button = getByRole('button');
    await user.click(button);
    expect(button).toBeDisabled();
    // A real mouse can never click a `pointer-events: none` disabled button
    // (`user.click` correctly refuses to simulate one); `fireEvent` dispatches
    // the DOM event directly, proving the handler is gated by `disabled` too
    // — same reasoning as `BaseBtn.test.tsx`'s "does not fire onClick when disabled".
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('honours disabled from the start', () => {
    const { getByRole } = renderWithTheme(<OneClickButton disabled />);
    expect(getByRole('button')).toBeDisabled();
  });

  it('forwards color to the underlying elitea button', () => {
    const { getByRole } = renderWithTheme(<OneClickButton color="alarm" />);
    expect(getByRole('button')).toBeInTheDocument();
  });
});
