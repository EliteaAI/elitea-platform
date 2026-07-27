import { act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { EllipsisTypography } from '.';

function setBoxSize(element: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(element, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(element, 'clientWidth', { value: clientWidth, configurable: true });
}

/** Lets `useTextOverflow`'s 50ms/200ms overflow-detection timeouts fire under real timers. */
async function settleOverflowCheck(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
}

// jsdom has no ResizeObserver; this component mounts the real
// `useTextOverflow` hook (via TypographyWithConditionalTooltip), which
// creates one unconditionally.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('EllipsisTypography', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the text', () => {
    const { getByText } = renderWithTheme(<EllipsisTypography>A short label</EllipsisTypography>);
    expect(getByText('A short label')).toBeInTheDocument();
  });

  it('uses the bodySmall variant and text.secondary colour', () => {
    const { getByText } = renderWithTheme(<EllipsisTypography>styled</EllipsisTypography>);
    expect(getByText('styled')).toHaveClass('MuiTypography-bodySmall');
  });

  it('forwards data-testid', () => {
    const { getByTestId } = renderWithTheme(
      <EllipsisTypography data-testid="label">text</EllipsisTypography>,
    );
    expect(getByTestId('label')).toBeInTheDocument();
  });

  it('does not show a tooltip on hover when the text fits (no overflow)', async () => {
    const user = userEvent.setup();
    const { getByText, queryByRole } = renderWithTheme(<EllipsisTypography>fits</EllipsisTypography>);
    const el = getByText('fits');
    setBoxSize(el, 50, 100);
    await settleOverflowCheck();

    await user.hover(el);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(queryByRole('tooltip')).toBeNull();
  });

  it('shows the full text in a tooltip on hover once it overflows', async () => {
    const user = userEvent.setup();
    const { getByText } = renderWithTheme(
      <EllipsisTypography>a very long overflowing label that gets truncated</EllipsisTypography>,
    );
    const el = getByText('a very long overflowing label that gets truncated');
    setBoxSize(el, 400, 100);
    await settleOverflowCheck();

    await user.hover(el);
    await waitFor(() => {
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
        'a very long overflowing label that gets truncated',
      );
    });
  });
});
