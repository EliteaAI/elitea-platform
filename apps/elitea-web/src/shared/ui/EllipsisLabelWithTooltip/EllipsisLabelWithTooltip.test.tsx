import { act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { EllipsisLabelWithTooltip } from '.';

function setBoxSize(element: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(element, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(element, 'clientWidth', { value: clientWidth, configurable: true });
}

/** Lets the hook's 50ms/200ms overflow-detection timeouts fire under real timers. */
async function settleOverflowCheck(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
}

// jsdom has no ResizeObserver (same gap useTextOverflow.test.tsx works
// around); this component mounts the real hook, so every test needs the
// stub, not just the ones that assert on resize behaviour directly.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('EllipsisLabelWithTooltip', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the label text', () => {
    const { getByText } = renderWithTheme(<EllipsisLabelWithTooltip label="A short label" />);
    expect(getByText('A short label')).toBeInTheDocument();
  });

  it('does not show a tooltip on hover when the label fits (no overflow)', async () => {
    const user = userEvent.setup();
    const { getByText, queryByRole } = renderWithTheme(<EllipsisLabelWithTooltip label="fits" />);
    const el = getByText('fits');
    setBoxSize(el, 50, 100);
    await settleOverflowCheck();

    await user.hover(el);
    // Give MUI's enter-delay a moment; the tooltip must never appear since
    // `title` is '' (not overflowing) — a `waitFor` that expects "still
    // absent" would need a fixed timeout instead, so assert immediately and
    // again after a short wait.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(queryByRole('tooltip')).toBeNull();
  });

  it('shows the full label in a tooltip on hover once the text overflows', async () => {
    const user = userEvent.setup();
    const { getByText } = renderWithTheme(<EllipsisLabelWithTooltip label="a very long overflowing label" />);
    const el = getByText('a very long overflowing label');
    setBoxSize(el, 400, 100);
    await settleOverflowCheck();

    await user.hover(el);
    await waitFor(() => {
      expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    });
  });

  it('renders as an inline span-like element (component="span")', () => {
    const { getByText } = renderWithTheme(<EllipsisLabelWithTooltip label="inline" />);
    expect(getByText('inline').tagName).toBe('SPAN');
  });

  it('applies a custom typography variant', () => {
    const { getByText } = renderWithTheme(
      <EllipsisLabelWithTooltip
        label="styled"
        variant="labelSmall"
      />,
    );
    expect(getByText('styled')).toHaveClass('MuiTypography-labelSmall');
  });

  it('forwards a custom placement to the underlying Tooltip without throwing', () => {
    expect(() =>
      renderWithTheme(
        <EllipsisLabelWithTooltip
          label="bottom-placed"
          placement="bottom"
        />,
      ),
    ).not.toThrow();
  });
});
