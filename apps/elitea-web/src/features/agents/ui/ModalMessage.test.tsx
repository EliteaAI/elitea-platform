import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '../__tests__/testUtils';

import { ModalMessage } from './ModalMessage';

// Real `handleCopy` (`shared/lib/clipboard.ts`) runs; only the browser's own
// Clipboard API is stubbed — same boundary `shared/lib/clipboard.test.ts`
// itself stubs at, and what R-M1 (§6.2) actually restricts is `vi.mock()`
// of app modules, not a real Web API.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ModalMessage', () => {
  it('renders the title and markdown message', () => {
    renderWithProviders(
      <ModalMessage
        title="assistant"
        message="Hello **world**"
      />,
    );
    expect(screen.getByText('assistant')).toBeInTheDocument();
    expect(screen.getByText('world')).toBeInTheDocument();
  });

  it('renders plain text (not markdown) when renderInMarkdown is false', () => {
    renderWithProviders(
      <ModalMessage
        title="assistant"
        message="Hello **world**"
        renderInMarkdown={false}
      />,
    );
    expect(screen.getByText('Hello **world**')).toBeInTheDocument();
  });

  it('keeps the copy button hover-revealed (hidden until the message content is hovered)', () => {
    // Baseline (`ModalMessage.jsx`) renders the copy button's container with
    // `visibility: 'hidden'`, revealed only via `messageContent`'s own
    // `'&:hover .actionButtons': { visibility: 'visible' }` rule. A port
    // that drops both makes the button permanently visible.
    renderWithProviders(
      <ModalMessage
        title="assistant"
        message="content"
      />,
    );
    // `visibility: hidden` removes the button from the default (visible-only)
    // accessibility tree that `getByRole` queries — `hidden: true` is needed
    // to find it at all, which is itself part of what this test verifies.
    const copyButton = screen.getByRole('button', { hidden: true });
    const actionsContainer = copyButton.parentElement;
    expect(actionsContainer).not.toBeNull();
    expect(getComputedStyle(actionsContainer as HTMLElement).visibility).toBe('hidden');
    expect(actionsContainer).toHaveClass('actionButtons');
  });

  it('calls onCopied after the copy action resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const onCopied = vi.fn();
    renderWithProviders(
      <ModalMessage
        title="assistant"
        message="content to copy"
        onCopied={onCopied}
      />,
    );
    // Hover-revealed via CSS only (`visibility: hidden` by default) — the
    // button is still present and clickable, just excluded from the
    // default accessible-role query without `hidden: true`.
    fireEvent.click(screen.getByRole('button', { hidden: true }));
    await vi.waitFor(() => expect(onCopied).toHaveBeenCalled());
    expect(writeText).toHaveBeenCalledWith('content to copy');
  });

  it('calls onCopyFailed (not onCopied) when the clipboard write genuinely fails', async () => {
    // Restored parity target: the baseline's `onCopy` gets a REAL
    // success/failure result from a direct `navigator.clipboard.writeText`
    // call (`ModalMessage.jsx:18-25`) — this asserts the new port's
    // `onCopyFailed` channel is actually wired to a real rejection, not a
    // dead callback that can never fire (see this file's own module doc
    // comment).
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const onCopied = vi.fn();
    const onCopyFailed = vi.fn();
    renderWithProviders(
      <ModalMessage
        title="assistant"
        message="content to copy"
        onCopied={onCopied}
        onCopyFailed={onCopyFailed}
      />,
    );
    fireEvent.click(screen.getByRole('button', { hidden: true }));
    await vi.waitFor(() => expect(onCopyFailed).toHaveBeenCalled());
    expect(onCopied).not.toHaveBeenCalled();
  });
});
