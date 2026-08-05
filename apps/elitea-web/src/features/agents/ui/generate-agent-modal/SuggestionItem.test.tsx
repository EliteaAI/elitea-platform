import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { SuggestionItem } from './SuggestionItem';

describe('SuggestionItem', () => {
  it('renders the item name', () => {
    renderWithTheme(
      <SuggestionItem
        item={{ id: 1, name: 'My Toolkit' }}
        checked={false}
        onToggle={vi.fn()}
        entityType="toolkit"
      />,
    );
    expect(screen.getByText('My Toolkit')).toBeInTheDocument();
  });

  it('shows the toolkit type as secondary text when it differs from the name', () => {
    renderWithTheme(
      <SuggestionItem
        item={{ id: 1, name: 'My Toolkit', type: 'github' }}
        checked={false}
        onToggle={vi.fn()}
        entityType="toolkit"
      />,
    );
    expect(screen.getByText('github')).toBeInTheDocument();
  });

  it('shows the description as secondary text for non-toolkit entity types', () => {
    renderWithTheme(
      <SuggestionItem
        item={{ id: 1, name: 'My Agent', description: 'Handles support tickets' }}
        checked={false}
        onToggle={vi.fn()}
        entityType="agent"
      />,
    );
    expect(screen.getByText('Handles support tickets')).toBeInTheDocument();
  });

  it('hides secondary text when it matches the name', () => {
    renderWithTheme(
      <SuggestionItem
        item={{ id: 1, name: 'Same', description: 'Same' }}
        checked={false}
        onToggle={vi.fn()}
        entityType="agent"
      />,
    );
    expect(screen.getAllByText('Same')).toHaveLength(1);
  });

  it('reflects the checked state', () => {
    renderWithTheme(
      <SuggestionItem
        item={{ id: 1, name: 'My Agent' }}
        checked
        onToggle={vi.fn()}
        entityType="agent"
      />,
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('calls onToggle with the item id when the row is clicked', () => {
    const onToggle = vi.fn();
    renderWithTheme(
      <SuggestionItem
        item={{ id: 'abc', name: 'My Agent' }}
        checked={false}
        onToggle={onToggle}
        entityType="agent"
      />,
    );
    fireEvent.click(screen.getByText('My Agent'));
    expect(onToggle).toHaveBeenCalledWith('abc');
  });

  it('calls onToggle exactly once when the checkbox itself is clicked (event does not bubble twice)', () => {
    const onToggle = vi.fn();
    renderWithTheme(
      <SuggestionItem
        item={{ id: 'abc', name: 'My Agent' }}
        checked={false}
        onToggle={onToggle}
        entityType="agent"
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('abc');
  });
});
