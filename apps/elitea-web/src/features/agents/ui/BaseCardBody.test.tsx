import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { BaseCardBody } from './BaseCardBody';

// jsdom has no ResizeObserver; TypographyWithConditionalTooltip mounts the
// real `useTextOverflow` hook, which creates one unconditionally (same stub
// as that component's own test file).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('BaseCardBody', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the tool description when there are no selected tools', () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <BaseCardBody
        tool={{ description: 'Reads and writes files' }}
        onClickShowActions={vi.fn()}
        showActions={false}
      />,
    );
    expect(getByText('Reads and writes files')).toBeInTheDocument();
    expect(queryByTestId('base-card-body-toggle')).not.toBeInTheDocument();
  });

  it('renders a "Show tools" toggle when there are selected tools and actions are hidden', () => {
    const { getByText } = renderWithTheme(
      <BaseCardBody
        tool={{ description: 'x', settings: { selected_tools: ['read_file'] } }}
        onClickShowActions={vi.fn()}
        showActions={false}
      />,
    );
    expect(getByText('Show tools')).toBeInTheDocument();
  });

  it('renders a "Hide tools" toggle when actions are shown', () => {
    const { getByText } = renderWithTheme(
      <BaseCardBody
        tool={{ settings: { selected_tools: ['read_file'] } }}
        onClickShowActions={vi.fn()}
        showActions
      />,
    );
    expect(getByText('Hide tools')).toBeInTheDocument();
  });

  it('calls onClickShowActions when the toggle is clicked or activated by keyboard', async () => {
    const user = userEvent.setup();
    const onClickShowActions = vi.fn();
    const { getByTestId } = renderWithTheme(
      <BaseCardBody
        tool={{ settings: { selected_tools: ['read_file'] } }}
        onClickShowActions={onClickShowActions}
        showActions={false}
      />,
    );
    const toggle = getByTestId('base-card-body-toggle');
    await user.click(toggle);
    expect(onClickShowActions).toHaveBeenCalledTimes(1);

    toggle.focus();
    await user.keyboard('{Enter}');
    expect(onClickShowActions).toHaveBeenCalledTimes(2);
  });
});
