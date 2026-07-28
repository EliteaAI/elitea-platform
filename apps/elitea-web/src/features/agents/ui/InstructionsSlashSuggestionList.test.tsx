import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '../__tests__/testUtils';
import { MentionPhase } from '../lib/constants/mention.constants';

import { InstructionsSlashSuggestionList } from './InstructionsSlashSuggestionList';

describe('InstructionsSlashSuggestionList', () => {
  it('renders nothing while idle', () => {
    const { container } = renderWithProviders(
      <InstructionsSlashSuggestionList
        phase={MentionPhase.Idle}
        filteredItems={[]}
        filteredTools={[]}
        selectedItem={undefined}
        highlightedIndex={-1}
        onSelectItem={vi.fn()}
        onSelectTool={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the mention items list in the items phase', () => {
    renderWithProviders(
      <InstructionsSlashSuggestionList
        phase={MentionPhase.Items}
        filteredItems={[
          { name: 'github', description: 'GitHub toolkit', isToolkit: true },
          { name: 'my_pipeline', description: 'A pipeline' },
        ]}
        filteredTools={[]}
        selectedItem={undefined}
        highlightedIndex={0}
        onSelectItem={vi.fn()}
        onSelectTool={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('my_pipeline')).toBeInTheDocument();
  });

  it('calls onSelectItem with the item and its isToolkit flag when clicked', () => {
    const onSelectItem = vi.fn();
    renderWithProviders(
      <InstructionsSlashSuggestionList
        phase={MentionPhase.Items}
        filteredItems={[{ name: 'github', description: 'GitHub toolkit', isToolkit: true }]}
        filteredTools={[]}
        selectedItem={undefined}
        highlightedIndex={-1}
        onSelectItem={onSelectItem}
        onSelectTool={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('github'));
    expect(onSelectItem).toHaveBeenCalledWith({ name: 'github', description: 'GitHub toolkit', isToolkit: true }, true);
  });

  it('renders nothing in the items phase when there are no filtered items', () => {
    const { container } = renderWithProviders(
      <InstructionsSlashSuggestionList
        phase={MentionPhase.Items}
        filteredItems={[]}
        filteredTools={[]}
        selectedItem={undefined}
        highlightedIndex={-1}
        onSelectItem={vi.fn()}
        onSelectTool={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the tools list (via MentionToolList) in the tools phase', () => {
    renderWithProviders(
      <InstructionsSlashSuggestionList
        phase={MentionPhase.Tools}
        filteredItems={[]}
        filteredTools={[{ name: 'list_repos', description: 'List repositories' }]}
        selectedItem={{ name: 'github' }}
        highlightedIndex={0}
        onSelectItem={vi.fn()}
        onSelectTool={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('list_repos')).toBeInTheDocument();
  });

  it('calls onSelectTool when a tool row is clicked', () => {
    const onSelectTool = vi.fn();
    renderWithProviders(
      <InstructionsSlashSuggestionList
        phase={MentionPhase.Tools}
        filteredItems={[]}
        filteredTools={[{ name: 'list_repos' }]}
        selectedItem={{ name: 'github' }}
        highlightedIndex={-1}
        onSelectItem={vi.fn()}
        onSelectTool={onSelectTool}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('list_repos'));
    expect(onSelectTool).toHaveBeenCalledWith('list_repos');
  });

  it('renders nothing in the tools phase when there are no filtered tools', () => {
    const { container } = renderWithProviders(
      <InstructionsSlashSuggestionList
        phase={MentionPhase.Tools}
        filteredItems={[]}
        filteredTools={[]}
        selectedItem={{ name: 'github' }}
        highlightedIndex={-1}
        onSelectItem={vi.fn()}
        onSelectTool={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
