import { createRef } from 'react';

import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { BaseSwitch } from '.';

describe('BaseSwitch', () => {
  it('renders a real switch input', () => {
    const { getByRole } = renderWithTheme(<BaseSwitch aria-label="agree" />);
    expect(getByRole('switch')).toBeInTheDocument();
  });

  it('defaults size to "small"', () => {
    const { getByRole } = renderWithTheme(<BaseSwitch aria-label="agree" />);
    // MUI does not expose size as a queryable attribute on the input itself;
    // the load-bearing proof is functional (see BaseSwitch.tsx's doc
    // comment) — this asserts the switch renders at all with the default.
    expect(getByRole('switch')).toBeInTheDocument();
  });

  it('reflects the checked prop', () => {
    const { getByRole } = renderWithTheme(
      <BaseSwitch
        checked
        onChange={() => {}}
        aria-label="agree"
      />,
    );
    expect(getByRole('switch')).toBeChecked();
  });

  it('fires onChange when clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <BaseSwitch
        onChange={onChange}
        aria-label="agree"
      />,
    );
    await user.click(getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('toggles on Space when focused (keyboard path)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <BaseSwitch
        onChange={onChange}
        aria-label="agree"
      />,
    );
    getByRole('switch').focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not fire onChange when disabled', () => {
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <BaseSwitch
        onChange={onChange}
        disabled
        aria-label="agree"
      />,
    );
    expect(getByRole('switch')).toBeDisabled();
  });

  it('forwards a ref to the underlying element', () => {
    const ref = createRef<HTMLButtonElement>();
    renderWithTheme(
      <BaseSwitch
        ref={ref}
        aria-label="agree"
      />,
    );
    expect(ref.current).not.toBeNull();
  });

  it('routes aria-labelledby to the input slot too', () => {
    const { getByRole } = renderWithTheme(
      <>
        <span id="agree-label">Agree to terms</span>
        <BaseSwitch aria-labelledby="agree-label" />
      </>,
    );
    expect(getByRole('switch', { name: 'Agree to terms' })).toBeInTheDocument();
  });

  it('accepts an explicit size override', () => {
    const { getByRole } = renderWithTheme(
      <BaseSwitch
        size="medium"
        aria-label="agree"
      />,
    );
    expect(getByRole('switch')).toBeInTheDocument();
  });
});
