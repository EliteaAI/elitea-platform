import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ChatConversationStarters } from './ChatConversationStarters';

// jsdom has no ResizeObserver; each rendered starter is an
// `EllipsisTextWithTooltip`, which mounts one unconditionally.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('ChatConversationStarters', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when there are no starters', () => {
    const { container } = renderWithTheme(
      <ChatConversationStarters
        conversationStarters={undefined}
        onSend={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when every starter is blank', () => {
    const { container } = renderWithTheme(
      <ChatConversationStarters
        conversationStarters={['', '   ', null, undefined]}
        onSend={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each non-blank starter', () => {
    const { getByText } = renderWithTheme(
      <ChatConversationStarters
        conversationStarters={['Hi there', '  ', 'Tell me a joke']}
        onSend={vi.fn()}
      />,
    );
    expect(getByText('Hi there')).toBeInTheDocument();
    expect(getByText('Tell me a joke')).toBeInTheDocument();
  });

  it('stringifies non-string entries before rendering', () => {
    const { getByText } = renderWithTheme(
      <ChatConversationStarters
        conversationStarters={[42]}
        onSend={vi.fn()}
      />,
    );
    expect(getByText('42')).toBeInTheDocument();
  });

  it('calls onSend with the clicked starter', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const { getByText } = renderWithTheme(
      <ChatConversationStarters
        conversationStarters={['Hi there', 'Tell me a joke']}
        onSend={onSend}
      />,
    );

    await user.click(getByText('Tell me a joke'));
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Tell me a joke');
  });
});
