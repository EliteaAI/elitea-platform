import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../__tests__/testUtils';
import { ArtifactPreviewContent } from './ArtifactPreviewContent';

const baseProps = {
  filename: 'file.txt',
  content: 'hello',
  mode: 'rendered' as const,
  onChange: vi.fn(),
  onDownload: vi.fn(),
};

describe('ArtifactPreviewContent', () => {
  it('renders Markdown and data tables', () => {
    const { rerender } = renderWithProviders(
      <ArtifactPreviewContent
        {...baseProps}
        filename="readme.md"
        kind="markdown"
        content="# Hello"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
    rerender(
      <ArtifactPreviewContent
        {...baseProps}
        filename="table.csv"
        kind="csv"
        content={'name,age\nAda,36'}
      />,
    );
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('36')).toBeInTheDocument();
  });

  it('renders raw Mermaid definitions and image states', () => {
    const { rerender } = renderWithProviders(
      <ArtifactPreviewContent
        {...baseProps}
        filename="flow.mmd"
        kind="mermaid"
        content="graph TD; A-->B"
      />,
    );
    expect(screen.getByText('graph TD; A-->B')).toBeInTheDocument();
    rerender(
      <ArtifactPreviewContent
        {...baseProps}
        filename="image.png"
        kind="image"
        imageUrl="blob:image"
      />,
    );
    expect(screen.getByRole('img', { name: 'image.png' })).toHaveAttribute('src', 'blob:image');
    rerender(
      <ArtifactPreviewContent
        {...baseProps}
        filename="image.png"
        kind="image"
      />,
    );
    expect(screen.getByText('No image to display.')).toBeInTheDocument();
  });

  it('uses download-only fallbacks for DOCX and unsupported files', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    const { rerender } = renderWithProviders(
      <ArtifactPreviewContent
        {...baseProps}
        filename="report.docx"
        kind="docx"
        onDownload={onDownload}
      />,
    );
    expect(screen.getByText(/DOCX editing/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download file' }));
    expect(onDownload).toHaveBeenCalled();
    rerender(
      <ArtifactPreviewContent
        {...baseProps}
        filename="archive.zip"
        kind="unsupported"
      />,
    );
    expect(screen.getByText('This file type cannot be previewed.')).toBeInTheDocument();
  });

  it('renders the editor for code mode and an empty-data message', () => {
    const { rerender } = renderWithProviders(
      <ArtifactPreviewContent
        {...baseProps}
        filename="file.txt"
        kind="text"
        mode="code"
      />,
    );
    expect(screen.getByLabelText('Edit file.txt')).toBeInTheDocument();
    rerender(
      <ArtifactPreviewContent
        {...baseProps}
        filename="empty.tsv"
        kind="tsv"
        content=""
      />,
    );
    expect(screen.getByText('No data to display.')).toBeInTheDocument();
  });
});
