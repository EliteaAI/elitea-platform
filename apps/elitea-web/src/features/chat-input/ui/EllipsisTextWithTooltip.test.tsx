import { act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { EllipsisTextWithTooltip } from './EllipsisTextWithTooltip';

function setBoxSize(element: HTMLElement, sizes: { scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number }): void {
  Object.defineProperty(element, 'scrollHeight', { value: sizes.scrollHeight, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: sizes.clientHeight, configurable: true });
  Object.defineProperty(element, 'scrollWidth', { value: sizes.scrollWidth, configurable: true });
  Object.defineProperty(element, 'clientWidth', { value: sizes.clientWidth, configurable: true });
}

/** Lets `useClampOverflow`'s 50ms/200ms overflow-detection timeouts fire under real timers — same technique as `shared/ui/ConditionalTooltip.test.tsx`. */
async function settleOverflowCheck(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
}

// jsdom has no ResizeObserver; this component mounts one unconditionally (see useClampOverflow).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('EllipsisTextWithTooltip', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the text', () => {
    const { getByText } = renderWithTheme(
      <EllipsisTextWithTooltip
        text="Hello there"
        onClick={vi.fn()}
      />,
    );
    expect(getByText('Hello there')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByText } = renderWithTheme(
      <EllipsisTextWithTooltip
        text="Click me"
        onClick={onClick}
      />,
    );

    await user.click(getByText('Click me'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not show a tooltip on hover when the text fits (no clamp overflow)', async () => {
    const user = userEvent.setup();
    const { getByText, queryByRole } = renderWithTheme(
      <EllipsisTextWithTooltip
        text="Fits fine"
        onClick={vi.fn()}
      />,
    );
    const el = getByText('Fits fine');
    setBoxSize(el, { scrollHeight: 20, clientHeight: 40, scrollWidth: 50, clientWidth: 100 });
    await settleOverflowCheck();

    await user.hover(el);
    expect(queryByRole('tooltip')).toBeNull();
  });

  it('shows the full text in a tooltip once the 2-line clamp truncates it (height overflow)', async () => {
    const user = userEvent.setup();
    const { getByText } = renderWithTheme(
      <EllipsisTextWithTooltip
        text="A very long starter that gets clamped to two lines"
        onClick={vi.fn()}
      />,
    );
    const el = getByText('A very long starter that gets clamped to two lines');
    setBoxSize(el, { scrollHeight: 80, clientHeight: 40, scrollWidth: 100, clientWidth: 100 });
    await settleOverflowCheck();

    await user.hover(el);
    await waitFor(() => {
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('A very long starter that gets clamped to two lines');
    });
  });

  it('detects overflow on the width axis too', async () => {
    const user = userEvent.setup();
    const { getByText } = renderWithTheme(
      <EllipsisTextWithTooltip
        text="Wide overflow text"
        onClick={vi.fn()}
      />,
    );
    const el = getByText('Wide overflow text');
    setBoxSize(el, { scrollHeight: 40, clientHeight: 40, scrollWidth: 300, clientWidth: 100 });
    await settleOverflowCheck();

    await user.hover(el);
    await waitFor(() => {
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Wide overflow text');
    });
  });

  it('hides the tooltip again on mouse leave', async () => {
    const user = userEvent.setup();
    const { getByText } = renderWithTheme(
      <EllipsisTextWithTooltip
        text="Leaves"
        onClick={vi.fn()}
      />,
    );
    const el = getByText('Leaves');
    setBoxSize(el, { scrollHeight: 80, clientHeight: 40, scrollWidth: 100, clientWidth: 100 });
    await settleOverflowCheck();

    await user.hover(el);
    await waitFor(() => {
      expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    });

    await user.unhover(el);
    await waitFor(() => {
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
    });
  });
});
