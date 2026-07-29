import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../__tests__/testUtils';

import { ToolkitMentionList } from './ToolkitMentionList';
import type { SlashParticipantToolkit } from '../lib/hooks/useSlashMention';

const TOOLKITS: SlashParticipantToolkit[] = [
  { id: 'tk-1', projectId: 'p-1', type: 'github', name: 'GitHub' },
  { id: 'tk-2', projectId: 'p-1', type: 'mcp', name: 'My MCP' },
];

describe('ToolkitMentionList', () => {
  it('renders the title and every toolkit name', () => {
    const { getByText } = renderWithProviders(
      <ToolkitMentionList
        toolkits={TOOLKITS}
        onSelectToolkit={vi.fn()}
        onClose={vi.fn()}
        title="Mention Toolkit"
        activeIndex={-1}
      />,
    );
    expect(getByText('Mention Toolkit')).toBeInTheDocument();
    expect(getByText('GitHub')).toBeInTheDocument();
    expect(getByText('My MCP')).toBeInTheDocument();
  });

  it('labels non-MCP toolkits "Toolkit" and MCP toolkits "MCP"', () => {
    const { getByText } = renderWithProviders(
      <ToolkitMentionList
        toolkits={TOOLKITS}
        onSelectToolkit={vi.fn()}
        onClose={vi.fn()}
        title="Mention Toolkit"
        activeIndex={-1}
      />,
    );
    expect(getByText('Toolkit')).toBeInTheDocument();
    expect(getByText('MCP')).toBeInTheDocument();
  });

  it('calls onSelectToolkit with the clicked row', () => {
    const onSelectToolkit = vi.fn();
    const { getByText } = renderWithProviders(
      <ToolkitMentionList
        toolkits={TOOLKITS}
        onSelectToolkit={onSelectToolkit}
        onClose={vi.fn()}
        title="Mention Toolkit"
        activeIndex={-1}
      />,
    );
    getByText('GitHub').click();
    expect(onSelectToolkit).toHaveBeenCalledWith(TOOLKITS[0]);
  });

  it('marks the row at activeIndex as highlighted', () => {
    const { getAllByRole } = renderWithProviders(
      <ToolkitMentionList
        toolkits={TOOLKITS}
        onSelectToolkit={vi.fn()}
        onClose={vi.fn()}
        title="Mention Toolkit"
        activeIndex={1}
      />,
    );
    const buttons = getAllByRole('button');
    expect(buttons[0]?.getAttribute('data-highlighted')).toBeNull();
    expect(buttons[1]?.getAttribute('data-highlighted')).toBe('true');
  });

  it('shows "No matching results" when toolkits is empty', () => {
    const { getByText, queryAllByRole } = renderWithProviders(
      <ToolkitMentionList
        toolkits={[]}
        onSelectToolkit={vi.fn()}
        onClose={vi.fn()}
        title="Mention Toolkit"
        activeIndex={-1}
      />,
    );
    expect(getByText('No matching results')).toBeInTheDocument();
    expect(queryAllByRole('button')).toHaveLength(0);
  });

  it('calls onClose on an outside click', async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <div>
        <button type="button">outside</button>
        <ToolkitMentionList
          toolkits={TOOLKITS}
          onSelectToolkit={vi.fn()}
          onClose={onClose}
          title="Mention Toolkit"
          activeIndex={-1}
        />
      </div>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders an img icon when iconUrl is present, and a fallback glyph otherwise', () => {
    const withIcon: SlashParticipantToolkit = { id: 'tk-3', projectId: 'p-1', type: 'github', name: 'Iconed', iconUrl: 'https://x/y.png' };
    const { container } = renderWithProviders(
      <ToolkitMentionList
        toolkits={[withIcon]}
        onSelectToolkit={vi.fn()}
        onClose={vi.fn()}
        title="Mention Toolkit"
        activeIndex={-1}
      />,
    );
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute('src')).toBe('https://x/y.png');
  });

  it('does not crash when activeIndex points past an empty toolkits list', () => {
    expect(() =>
      renderWithProviders(
        <ToolkitMentionList
          toolkits={[]}
          onSelectToolkit={vi.fn()}
          onClose={vi.fn()}
          title="Mention Toolkit"
          activeIndex={0}
        />,
      ),
    ).not.toThrow();
  });

  it('forwards data-testid', () => {
    const { getByTestId } = renderWithProviders(
      <ToolkitMentionList
        toolkits={TOOLKITS}
        onSelectToolkit={vi.fn()}
        onClose={vi.fn()}
        title="Mention Toolkit"
        activeIndex={-1}
        data-testid="toolkit-mention-list"
      />,
    );
    expect(getByTestId('toolkit-mention-list')).toBeInTheDocument();
  });
});
