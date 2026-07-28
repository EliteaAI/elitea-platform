import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import { ToolMenuDropdown } from './ToolMenuDropdown';
import type { ToolMenuDropdownItem } from './ToolMenuDropdown';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderMenu(props: Partial<React.ComponentProps<typeof ToolMenuDropdown>> = {}) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const defaults: React.ComponentProps<typeof ToolMenuDropdown> = {
    anchorEl: anchor,
    onClose: vi.fn(),
    items: [],
    search: '',
    onSearchChange: vi.fn(),
    searchPlaceholder: 'Search...',
    emptyMessage: 'Nothing here',
  };
  return render(
    <ThemeProvider
      theme={theme}
      defaultMode={DEFAULT_COLOR_SCHEME}
    >
      <ToolMenuDropdown {...defaults} {...props} />
    </ThemeProvider>,
  );
}

describe('ToolMenuDropdown', () => {
  it('renders nothing (closed) when anchorEl is null', () => {
    renderMenu({ anchorEl: null });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders the empty message when items is empty and not loading', async () => {
    renderMenu({ items: [] });
    expect(await screen.findByText('Nothing here')).toBeInTheDocument();
  });

  it('renders a loading row instead of the empty message while loading with no items yet', async () => {
    renderMenu({ items: [], isLoading: true });
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Nothing here')).not.toBeInTheDocument();
  });

  it('renders each item with its label and description', async () => {
    const items: readonly ToolMenuDropdownItem[] = [
      { key: 'a', label: 'GitHub', description: 'Source control', onClick: vi.fn() },
      { key: 'b', label: 'Jira', onClick: vi.fn() },
    ];
    renderMenu({ items });
    expect(await screen.findByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Source control')).toBeInTheDocument();
    expect(screen.getByText('Jira')).toBeInTheDocument();
  });

  it('calls the item onClick when clicked', async () => {
    const onClick = vi.fn();
    renderMenu({ items: [{ key: 'a', label: 'GitHub', onClick }] });
    fireEvent.click(await screen.findByText('GitHub'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a "Create new" row and calls onCreateNew when clicked', async () => {
    const onCreateNew = vi.fn();
    renderMenu({ onCreateNew, createNewLabel: 'Create new toolkit' });
    fireEvent.click(await screen.findByText('Create new toolkit'));
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it('does not render a "Create new" row when onCreateNew is not supplied', async () => {
    renderMenu({});
    expect(await screen.findByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByText('Create new')).not.toBeInTheDocument();
  });

  it('forwards search input changes to onSearchChange', async () => {
    const onSearchChange = vi.fn();
    renderMenu({ onSearchChange, searchPlaceholder: 'Search toolkits...', searchDebounceMs: 0 });
    const input = await screen.findByPlaceholderText('Search toolkits...');
    fireEvent.change(input, { target: { value: 'git' } });
    expect(onSearchChange).toHaveBeenCalledWith('git');
  });
});
