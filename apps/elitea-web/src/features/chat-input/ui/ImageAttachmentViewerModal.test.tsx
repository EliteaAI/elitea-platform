import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ImageAttachmentViewerModal } from './ImageAttachmentViewerModal';

describe('ImageAttachmentViewerModal', () => {
  it('renders nothing to the DOM when closed', () => {
    const { queryByText } = renderWithTheme(
      <ImageAttachmentViewerModal
        open={false}
        imageSource="data:image/png;base64,aGk="
        attachmentName="photo.png"
        onClose={() => {}}
        onDownload={() => {}}
        onRequestDelete={() => {}}
      />,
    );
    expect(queryByText('photo.png')).not.toBeInTheDocument();
  });

  it('renders the attachment name as the title and the image', () => {
    const { getByText, getByRole } = renderWithTheme(
      <ImageAttachmentViewerModal
        open
        imageSource="data:image/png;base64,aGk="
        attachmentName="photo.png"
        onClose={() => {}}
        onDownload={() => {}}
        onRequestDelete={() => {}}
      />,
    );
    expect(getByText('photo.png')).toBeInTheDocument();
    expect(getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', 'data:image/png;base64,aGk=');
  });

  it('fires onDownload/onRequestDelete from the header action buttons', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    const onRequestDelete = vi.fn();
    const { getByRole } = renderWithTheme(
      <ImageAttachmentViewerModal
        open
        imageSource="data:image/png;base64,aGk="
        attachmentName="photo.png"
        onClose={() => {}}
        onDownload={onDownload}
        onRequestDelete={onRequestDelete}
      />,
    );

    await user.click(getByRole('button', { name: 'Download image' }));
    expect(onDownload).toHaveBeenCalledTimes(1);

    await user.click(getByRole('button', { name: 'Remove attachment' }));
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape via the underlying Dialog\'s native handling — no extra listener needed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { getByRole } = renderWithTheme(
      <ImageAttachmentViewerModal
        open
        imageSource="data:image/png;base64,aGk="
        attachmentName="photo.png"
        onClose={onClose}
        onDownload={() => {}}
        onRequestDelete={() => {}}
      />,
    );

    getByRole('dialog').focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
