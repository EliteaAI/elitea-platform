import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { CategoryItemCard } from '.';

/**
 * jsdom does not implement `ResizeObserver` (same note as
 * `shared/ui/lib/useTextOverflow.test.tsx`, which this component's overflow
 * detection is built on). A minimal stub is enough — `useTextOverflow`'s
 * initial 50ms/200ms overflow checks don't depend on the observer actually
 * firing, only on the constructor existing.
 */
class ResizeObserverStub {
  observe(): void {
    // no-op: this suite drives overflow via the 50ms/200ms mount-time checks.
  }
  disconnect(): void {
    // no-op
  }
}

describe('CategoryItemCard', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the label as a real button (keyboard-reachable, R-C1 fix)', () => {
    const { getByRole } = renderWithTheme(<CategoryItemCard label="Tool name" />);
    const button = getByRole('button', { name: 'Tool name' });
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe('BUTTON');
  });

  it('renders the icon when given, hidden from assistive tech', () => {
    const { getByTestId, container } = renderWithTheme(
      <CategoryItemCard
        label="Tool name"
        icon={<svg data-testid="tool-icon" />}
        data-testid="card"
      />,
    );
    expect(getByTestId('tool-icon')).toBeInTheDocument();
    const iconContainer = getByTestId('tool-icon').parentElement;
    expect(iconContainer).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[data-testid="card"]')).toBeInTheDocument();
  });

  it('omits the icon container entirely when no icon is given', () => {
    const { queryByTestId } = renderWithTheme(<CategoryItemCard label="No icon" />);
    expect(queryByTestId('tool-icon')).not.toBeInTheDocument();
  });

  it('calls onClick on click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole } = renderWithTheme(
      <CategoryItemCard
        label="Tool name"
        onClick={onClick}
      />,
    );
    await user.click(getByRole('button', { name: 'Tool name' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('activates onClick via the keyboard (Enter)', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole } = renderWithTheme(
      <CategoryItemCard
        label="Tool name"
        onClick={onClick}
      />,
    );
    getByRole('button', { name: 'Tool name' }).focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onClick is omitted', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(<CategoryItemCard label="No handler" />);
    await user.click(getByRole('button', { name: 'No handler' }));
  });

  it('forwards data-testid', () => {
    const { getByTestId } = renderWithTheme(
      <CategoryItemCard
        label="Tool name"
        data-testid="my-card"
      />,
    );
    expect(getByTestId('my-card')).toBeInTheDocument();
  });

  it('shows a tooltip with the full label once the text is detected as overflowing', async () => {
    const user = userEvent.setup();
    const longLabel = 'A very long tool name that overflows its fixed width container element';
    const { getByText, findByRole } = renderWithTheme(<CategoryItemCard label={longLabel} />);
    const labelEl = getByText(longLabel);
    // Simulate real overflow: `useTextOverflow` compares scrollWidth to
    // clientWidth on a short delay after mount (`shared/ui/lib/useTextOverflow.ts`).
    Object.defineProperty(labelEl, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(labelEl, 'clientWidth', { value: 100, configurable: true });

    await user.hover(labelEl);
    const tooltip = await findByRole('tooltip', undefined, { timeout: 2000 });
    expect(tooltip).toHaveTextContent(longLabel);
  });

  it('shows no tooltip when the label fits (no overflow)', async () => {
    const user = userEvent.setup();
    const { getByText, queryByRole } = renderWithTheme(<CategoryItemCard label="Short" />);
    const labelEl = getByText('Short');
    Object.defineProperty(labelEl, 'scrollWidth', { value: 50, configurable: true });
    Object.defineProperty(labelEl, 'clientWidth', { value: 100, configurable: true });

    await user.hover(labelEl);
    // Give the (non-firing) overflow check's timers a moment, then confirm
    // MUI's Tooltip never mounted a popup (title='' disables it entirely).
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
