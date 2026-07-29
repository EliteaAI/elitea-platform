import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Bucket } from '@/entities/bucket';

import { renderWithProviders } from '../__tests__/testUtils';
import { BucketSidebar } from './BucketSidebar';

const buckets: Bucket[] = [
  { id: '1', name: 'docs', isPinned: false, createdAt: '2026-01-01T00:00:00Z' },
  { id: '2', name: 'images', isPinned: true, createdAt: '2026-01-02T00:00:00Z' },
];

function renderSidebar(overrides: Partial<Parameters<typeof BucketSidebar>[0]> = {}) {
  const props = {
    buckets,
    storageConfigurations: [{ id: 's1', title: 'Primary', shared: false }],
    loading: false,
    onStorageChange: vi.fn(),
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn().mockResolvedValue(undefined),
    onPin: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  renderWithProviders(<BucketSidebar {...props} />);
  return props;
}

describe('BucketSidebar', () => {
  it('selects, filters, creates, and toggles pins', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();
    await user.click(screen.getByText('docs'));
    expect(props.onSelect).toHaveBeenCalledWith(buckets[0]);
    await user.click(screen.getByRole('button', { name: 'Pin docs' }));
    expect(props.onPin).toHaveBeenCalledWith(buckets[0]);
    await user.click(screen.getByRole('button', { name: 'Create bucket' }));
    expect(props.onCreate).toHaveBeenCalled();
    await user.type(screen.getByPlaceholderText('Search buckets'), 'image');
    expect(screen.queryByText('docs')).not.toBeInTheDocument();
    expect(screen.getByText('images')).toBeInTheDocument();
  });

  it('renames and deletes through confirmation dialogs', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Rename docs' }));
    const input = screen.getByLabelText('Bucket name');
    await user.clear(input);
    await user.type(input, 'reports');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(props.onRename).toHaveBeenCalledWith(buckets[0], 'reports');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename bucket' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Delete docs' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.onDelete).toHaveBeenCalledWith(buckets[0]);
  });

  it('shows loading and empty states and changes storage', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(
      <BucketSidebar
        buckets={[]}
        storageConfigurations={[]}
        loading
        onStorageChange={vi.fn()}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onPin={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading buckets…')).toBeInTheDocument();
    rerender(
      <BucketSidebar
        buckets={[]}
        storageConfigurations={[]}
        loading={false}
        onStorageChange={vi.fn()}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onPin={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('No buckets found.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create bucket' }));
  });
});
