import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Artifact } from '@/entities/artifact';

import { renderWithProviders } from '../__tests__/testUtils';
import { ArtifactTable } from './ArtifactTable';

const contents: Artifact[] = [
  { key: 'folder/deep.txt', size: 20, lastModified: '2026-01-02T00:00:00Z', bucket: 'docs' },
  { key: 'alpha.txt', size: 10, lastModified: '2026-01-01T00:00:00Z', bucket: 'docs' },
  { key: 'beta.txt', size: 30, lastModified: '2026-01-03T00:00:00Z', bucket: 'docs' },
];

function renderTable(overrides: Partial<Parameters<typeof ArtifactTable>[0]> = {}) {
  const props = {
    contents,
    currentPrefix: '',
    loading: false,
    onPrefixChange: vi.fn(),
    onPreview: vi.fn(),
    onDownload: vi.fn(),
    onDownloadMany: vi.fn(),
    onDelete: vi.fn(),
    onUpload: vi.fn(),
    ...overrides,
  };
  const view = renderWithProviders(<ArtifactTable {...props} />);
  return { ...props, container: view.container };
}

describe('ArtifactTable', () => {
  it('renders folders and files and routes row actions', async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.click(screen.getByRole('button', { name: 'folder' }));
    expect(props.onPrefixChange).toHaveBeenCalledWith('folder/');
    await user.click(screen.getByRole('button', { name: 'alpha.txt' }));
    expect(props.onPreview).toHaveBeenCalledWith(expect.objectContaining({ key: 'alpha.txt' }));
    await user.click(screen.getByRole('button', { name: 'Download alpha.txt' }));
    expect(props.onDownload).toHaveBeenCalledWith(expect.objectContaining({ key: 'alpha.txt' }));
    await user.click(screen.getByRole('button', { name: 'Delete beta.txt' }));
    expect(props.onDelete).toHaveBeenCalledWith([expect.objectContaining({ key: 'beta.txt' })]);
  });

  it('searches, sorts, selects, and invokes bulk actions', async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.type(screen.getByPlaceholderText('Search files'), 'alpha');
    expect(screen.getByText('alpha.txt')).toBeInTheDocument();
    expect(screen.queryByText('beta.txt')).not.toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText('Search files'));
    await user.click(screen.getByRole('button', { name: 'Size' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select alpha.txt' }));
    await user.click(screen.getByRole('button', { name: 'Download selected' }));
    await user.click(screen.getByRole('button', { name: 'Delete selected' }));
    expect(props.onDownloadMany).toHaveBeenCalledWith([expect.objectContaining({ key: 'alpha.txt' })]);
    expect(props.onDelete).toHaveBeenCalledWith([expect.objectContaining({ key: 'alpha.txt' })]);
  });

  it('stages files from the picker and drag-and-drop', async () => {
    const user = userEvent.setup();
    const props = renderTable();
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) throw new Error('Expected file input');
    await user.upload(input, file);
    expect(props.onUpload).toHaveBeenCalledWith([file]);
    const dropTarget = props.container.firstElementChild;
    expect(dropTarget).not.toBeNull();
    if (dropTarget === null) throw new Error('Expected drop target');
    fireEvent.drop(dropTarget, {
      dataTransfer: { files: [file] },
    });
    expect(props.onUpload).toHaveBeenCalledTimes(2);
  });

  it('supports select-all, repeated sorting, and folder row navigation', async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.click(screen.getByRole('checkbox', { name: 'Select all artifacts' }));
    await user.click(screen.getByRole('button', { name: 'Download selected' }));
    expect(props.onDownloadMany).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: 'folder/' }),
      expect.objectContaining({ key: 'alpha.txt' }),
      expect.objectContaining({ key: 'beta.txt' }),
    ]));
    await user.click(screen.getByRole('button', { name: 'Name' }));
    await user.click(screen.getByRole('button', { name: 'Name' }));
    const folderRow = screen.getByText('folder').closest('tr');
    expect(folderRow).toBeInstanceOf(HTMLElement);
    if (!(folderRow instanceof HTMLElement)) throw new Error('Expected folder row');
    await user.dblClick(folderRow);
    expect(props.onPrefixChange).toHaveBeenCalledWith('folder/');
  });

  it('renders loading, error, breadcrumbs, and empty states', async () => {
    const user = userEvent.setup();
    const props = renderTable({
      contents: [],
      currentPrefix: 'a/b/',
      loading: true,
      error: 'Load failed',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Load failed');
    expect(screen.getByText('Loading files…')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Root' }));
    expect(props.onPrefixChange).toHaveBeenCalledWith('');
  });
});
