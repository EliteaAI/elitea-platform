import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../__tests__/testUtils';

import { UserMentionList } from './UserMentionList';
import type { UserMentionCandidate } from './UserMentionList';

const USERS: UserMentionCandidate[] = [
  { id: 'u-1', name: 'Alice Anderson' },
  { id: 'u-2', name: 'Bob Baker', avatarUrl: 'https://x/bob.png' },
];

describe('UserMentionList', () => {
  it('renders every user name', () => {
    const { getByText } = renderWithProviders(
      <UserMentionList
        users={USERS}
        onSelectUser={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(getByText('Alice Anderson')).toBeInTheDocument();
    expect(getByText('Bob Baker')).toBeInTheDocument();
  });

  it('renders nothing when the filtered list is empty', () => {
    const { container } = renderWithProviders(
      <UserMentionList
        users={[]}
        onSelectUser={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('filters by the query text after the leading "@"', () => {
    const { getByText, queryByText } = renderWithProviders(
      <UserMentionList
        users={USERS}
        query="@ali"
        onSelectUser={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(getByText('Alice Anderson')).toBeInTheDocument();
    expect(queryByText('Bob Baker')).not.toBeInTheDocument();
  });

  it('calls onSelectUser when a row is clicked', () => {
    const onSelectUser = vi.fn();
    const { getByText } = renderWithProviders(
      <UserMentionList
        users={USERS}
        onSelectUser={onSelectUser}
        onClose={vi.fn()}
      />,
    );
    getByText('Bob Baker').click();
    expect(onSelectUser).toHaveBeenCalledWith(USERS[1]);
  });

  it('renders an initials avatar when avatarUrl is absent, and an img when present', () => {
    const { container, getByText } = renderWithProviders(
      <UserMentionList
        users={USERS}
        onSelectUser={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(getByText('AA')).toBeInTheDocument();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://x/bob.png');
  });

  it('ArrowDown/ArrowUp/Enter navigate and select via a document-capture keydown listener', () => {
    const onSelectUser = vi.fn();
    renderWithProviders(
      <UserMentionList
        users={USERS}
        onSelectUser={onSelectUser}
        onClose={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelectUser).toHaveBeenCalledWith(USERS[1]);
  });

  it('calls onClose on an outside click', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <div>
        <button type="button">outside</button>
        <UserMentionList
          users={USERS}
          onSelectUser={vi.fn()}
          onClose={onClose}
        />
      </div>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('defaults users to [] and does not crash when omitted', () => {
    const { container } = renderWithProviders(
      <UserMentionList
        onSelectUser={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
