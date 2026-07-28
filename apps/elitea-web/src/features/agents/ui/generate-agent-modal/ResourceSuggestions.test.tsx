import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ResourceSuggestions } from './ResourceSuggestions';

describe('ResourceSuggestions', () => {
  it('renders nothing when items is undefined', () => {
    const { container } = renderWithTheme(
      <ResourceSuggestions
        title="Suggested Toolkits:"
        items={undefined}
        selectedIds={new Set()}
        onToggle={vi.fn()}
        entityType="toolkit"
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders nothing when items is empty', () => {
    const { container } = renderWithTheme(
      <ResourceSuggestions
        title="Suggested Toolkits:"
        items={[]}
        selectedIds={new Set()}
        onToggle={vi.fn()}
        entityType="toolkit"
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders the title and one row per item', () => {
    renderWithTheme(
      <ResourceSuggestions
        title="Suggested Toolkits:"
        items={[
          { id: 1, name: 'GitHub' },
          { id: 2, name: 'Jira' },
        ]}
        selectedIds={new Set()}
        onToggle={vi.fn()}
        entityType="toolkit"
      />,
    );
    expect(screen.getByText('Suggested Toolkits:')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Jira')).toBeInTheDocument();
  });

  it('marks items present in selectedIds as checked', () => {
    renderWithTheme(
      <ResourceSuggestions
        title="Suggested Toolkits:"
        items={[
          { id: 1, name: 'GitHub' },
          { id: 2, name: 'Jira' },
        ]}
        selectedIds={new Set([2])}
        onToggle={vi.fn()}
        entityType="toolkit"
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
  });
});
