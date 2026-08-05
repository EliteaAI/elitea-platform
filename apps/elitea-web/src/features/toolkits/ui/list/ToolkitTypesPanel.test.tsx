import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../__tests__/testUtils';
import { ToolkitTypesPanel } from './ToolkitTypesPanel';

const tagList = [
  { id: 1, name: 'Confluence' },
  { id: 2, name: 'Jira' },
];

describe('ToolkitTypesPanel', () => {
  it('renders the title and every tag as a chip', () => {
    renderWithProviders(
      <ToolkitTypesPanel
        tagList={tagList}
        selectedTypes={[]}
        onSelectType={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('Types')).toBeInTheDocument();
    expect(screen.getByText('Confluence')).toBeInTheDocument();
    expect(screen.getByText('Jira')).toBeInTheDocument();
  });

  it('renders a custom title', () => {
    renderWithProviders(
      <ToolkitTypesPanel
        tagList={tagList}
        title="Categories"
        selectedTypes={[]}
        onSelectType={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('Categories')).toBeInTheDocument();
  });

  it('renders the empty-state message when tagList is empty', () => {
    renderWithProviders(
      <ToolkitTypesPanel
        tagList={[]}
        selectedTypes={[]}
        onSelectType={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('No types to display.')).toBeInTheDocument();
  });

  it('does not show the clear button when nothing is selected', () => {
    renderWithProviders(
      <ToolkitTypesPanel
        tagList={tagList}
        selectedTypes={[]}
        onSelectType={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Clear all')).not.toBeInTheDocument();
  });

  it('shows the clear button when something is selected, and calls onClear when clicked', () => {
    const onClear = vi.fn();
    renderWithProviders(
      <ToolkitTypesPanel
        tagList={tagList}
        selectedTypes={['Jira']}
        onSelectType={vi.fn()}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByLabelText('Clear all'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('calls onSelectType with the tag name when a chip is clicked', () => {
    const onSelectType = vi.fn();
    renderWithProviders(
      <ToolkitTypesPanel
        tagList={tagList}
        selectedTypes={[]}
        onSelectType={onSelectType}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Jira'));
    expect(onSelectType).toHaveBeenCalledWith('Jira');
  });

  it('marks a selected chip as aria-pressed', () => {
    renderWithProviders(
      <ToolkitTypesPanel
        tagList={tagList}
        selectedTypes={['Jira']}
        onSelectType={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('Jira').closest('[aria-pressed]')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Confluence').closest('[aria-pressed]')).toHaveAttribute('aria-pressed', 'false');
  });
});
