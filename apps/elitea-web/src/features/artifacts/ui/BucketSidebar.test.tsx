import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Bucket } from '@/entities/bucket';

import { renderWithProviders } from '../__tests__/testUtils';
import { BucketSidebar } from './BucketSidebar';

const buckets: Bucket[] = [
  { id: '1', name: 'docs', isPinned: false, createdAt: '2026-01-01T00:00:00Z', retentionDays: null },
  { id: '2', name: 'images', isPinned: true, createdAt: '2026-01-02T00:00:00Z', retentionDays: 30 },
];

function renderSidebar(overrides: Partial<Parameters<typeof BucketSidebar>[0]> = {}) {
  const props = {
    buckets,
    storageConfigurations: [{ id: 's1', title: 'Primary', shared: false }],
    loading: false,
    onStorageChange: vi.fn(),
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onEdit: vi.fn(),
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

  it('offers no rename affordance — S3 buckets cannot be renamed in place', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: 'Rename docs' })).not.toBeInTheDocument();
  });

  /**
   * The edit affordance the baseline reaches through `Buckets.jsx`'s
   * `handleEdit`. It hands the WHOLE bucket up, not just the name — the
   * caller needs the row to build the create-bucket link.
   */
  it('raises onEdit for the clicked bucket', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();
    await user.click(screen.getByRole('button', { name: 'Edit images' }));
    expect(props.onEdit).toHaveBeenCalledWith(buckets[1]);
  });

  it('deletes through a confirmation dialog', async () => {
    const user = userEvent.setup();
    const props = renderSidebar();
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
        onEdit={vi.fn()}
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
        onEdit={vi.fn()}
        onPin={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('No buckets found.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create bucket' }));
  });
});
