import { act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { TypographyWithConditionalTooltip } from '.';

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
// `useTextOverflow` hook, which creates one unconditionally.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('TypographyWithConditionalTooltip', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders children', () => {
    const { getByText } = renderWithTheme(
      <TypographyWithConditionalTooltip title="full text">short</TypographyWithConditionalTooltip>,
    );
    expect(getByText('short')).toBeInTheDocument();
  });

  it('forwards data-testid', () => {
    const { getByTestId } = renderWithTheme(
      <TypographyWithConditionalTooltip
        title="full text"
        data-testid="label"
      >
        short
      </TypographyWithConditionalTooltip>,
    );
    expect(getByTestId('label')).toBeInTheDocument();
  });

  it('applies a custom typography variant', () => {
    const { getByText } = renderWithTheme(
      <TypographyWithConditionalTooltip
        title="full text"
        variant="labelSmall"
      >
        styled
      </TypographyWithConditionalTooltip>,
    );
    expect(getByText('styled')).toHaveClass('MuiTypography-labelSmall');
  });

  it('does not show a tooltip on hover when the content fits (no overflow)', async () => {
    const user = userEvent.setup();
    const { getByText, queryByRole } = renderWithTheme(
      <TypographyWithConditionalTooltip title="full text">fits</TypographyWithConditionalTooltip>,
    );
    const el = getByText('fits');
    setBoxSize(el, 50, 100);
    await settleOverflowCheck();

    await user.hover(el);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(queryByRole('tooltip')).toBeNull();
  });

  it('shows the title in a tooltip on hover once the content overflows', async () => {
    const user = userEvent.setup();
    const { getByText } = renderWithTheme(
      <TypographyWithConditionalTooltip title="the full untruncated text">
        truncated…
      </TypographyWithConditionalTooltip>,
    );
    const el = getByText('truncated…');
    setBoxSize(el, 400, 100);
    await settleOverflowCheck();

    await user.hover(el);
    await waitFor(() => {
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
        'the full untruncated text',
      );
    });
  });
});
