import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Attachment } from '@/entities/attachment';
import { resetConfigForTests } from '@/shared/config/get-config';
import { server } from '@/test/setup';
import { artifactContentNotFound, artifactContentOk } from '@/test/msw/handlers/artifacts';
import type { CapturedArtifactsRequest } from '@/test/msw/handlers/artifacts';

import { renderWithProviders } from '../__tests__/testUtils';
import { ImageAttachment } from './ImageAttachment';

const globals = globalThis as unknown as Record<string, unknown>;

function setConfig(): void {
  globals['elitea_ui_config'] = {
    vite_server_url: '/api/v2',
    vite_base_uri: '/',
    vite_public_project_id: '1',
  };
  resetConfigForTests();
}

afterEach(() => {
  delete globals['elitea_ui_config'];
  resetConfigForTests();
  vi.restoreAllMocks();
});

const NO_IMAGE_ATTACHMENT: Attachment = {};

const PENDING_ATTACHMENT: Attachment = {
  item_details: {
    name: 'processing.png',
    content: [{ type: 'image_url', image_url: { url: 'filepath:/tmp/x.png' } }],
  },
};

const LEGACY_BASE64_ATTACHMENT: Attachment = {
  item_details: {
    name: 'thumb.png',
    content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } }],
  },
};

// `bucket` is a real wire field entities/attachment's own `AttachmentItemDetails`
// deliberately does not model — see `imageAttachment.helpers.ts`'s own
// `StoredItemDetails`/`storedItemDetails` doc comment. The `as Attachment`
// cast here is the test-side counterpart of that same disclosed gap.
const ARTIFACT_ATTACHMENT = {
  item_details: {
    name: 'photo.png',
    filepath: '/my-bucket/folder/photo.png',
    bucket: 'my-bucket',
    content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } }],
  },
} as Attachment;

describe('ImageAttachment', () => {
  it('renders nothing when there is no image source and nothing is pending', () => {
    const { container } = renderWithProviders(<ImageAttachment attachment={NO_IMAGE_ATTACHMENT} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the pending label for an unresolved filepath: URL, using the display name', () => {
    const { getByText, queryByRole } = renderWithProviders(<ImageAttachment attachment={PENDING_ATTACHMENT} />);
    expect(getByText('processing.png')).toBeInTheDocument();
    // The viewer never opens for a pending attachment (no resolved imageSource) — no dialog title text either.
    expect(queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the resolved thumbnail image and reports an error on load failure', () => {
    const onError = vi.fn();
    const { getByRole } = renderWithProviders(
      <ImageAttachment
        attachment={LEGACY_BASE64_ATTACHMENT}
        onError={onError}
      />,
    );
    const img = getByRole('img', { name: 'thumb.png' });
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    expect(onError).toHaveBeenCalledWith('Failed to load image');
  });

  it('opens the full-size viewer when the thumbnail is clicked, showing the attachment name as the title', async () => {
    const user = userEvent.setup();
    const { getByRole, findByText } = renderWithProviders(<ImageAttachment attachment={LEGACY_BASE64_ATTACHMENT} />);

    await user.click(getByRole('button', { name: 'View attachment' }));

    expect(await findByText('thumb.png')).toBeInTheDocument();
  });

  it('downloads via the legacy base64 branch when there is no real filepath', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const user = userEvent.setup();

    const { getByLabelText } = renderWithProviders(<ImageAttachment attachment={LEGACY_BASE64_ATTACHMENT} />);
    // `getByLabelText`, not `getByRole('button', {name})`: the hover-overlay
    // is `visibility: hidden` until `:hover`/`:focus-within` (jsdom does not
    // simulate `:hover`, and dom-testing-library's role-name computation
    // under `{hidden: true}` proved unreliable for these — `aria-label`
    // matching bypasses the accessible-tree visibility gate entirely, same
    // as it would for a real user tabbing in via `:focus-within`).
    await user.click(getByLabelText('Download image'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('downloads via artifact storage when a real filepath + bucket are present, given projectId and config', async () => {
    setConfig();
    const sink: CapturedArtifactsRequest[] = [];
    server.use(artifactContentOk(sink));
    const user = userEvent.setup();

    const { getByLabelText } = renderWithProviders(
      <ImageAttachment
        attachment={ARTIFACT_ATTACHMENT}
        projectId="p1"
      />,
    );
    await user.click(getByLabelText('Download image'));

    await vi.waitFor(() => expect(sink).toHaveLength(1));
    const request = sink[0];
    if (request === undefined) throw new Error('unreachable');
    expect(new URL(request.url).pathname).toBe('/api/v2/artifacts/objects/p1/my-bucket/folder/photo.png');
  });

  it('reports an error instead of downloading when projectId is missing for an artifact-storage attachment', async () => {
    setConfig();
    const onError = vi.fn();
    const user = userEvent.setup();

    const { getByLabelText } = renderWithProviders(
      <ImageAttachment
        attachment={ARTIFACT_ATTACHMENT}
        onError={onError}
      />,
    );
    await user.click(getByLabelText('Download image'));

    expect(onError).toHaveBeenCalledWith('Failed to download image from storage');
  });

  it('surfaces an HTTP failure from the artifact fetch through onError', async () => {
    setConfig();
    server.use(artifactContentNotFound());
    const onError = vi.fn();
    const user = userEvent.setup();

    const { getByLabelText } = renderWithProviders(
      <ImageAttachment
        attachment={ARTIFACT_ATTACHMENT}
        projectId="p1"
        onError={onError}
      />,
    );
    await user.click(getByLabelText('Download image'));

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Download error: HTTP 404'));
  });

  it('opens the delete-confirmation dialog and calls onRemoveAttachment with the filepath key and the checkbox state', async () => {
    const onRemoveAttachment = vi.fn();
    const user = userEvent.setup();

    const { getByLabelText, getByRole } = renderWithProviders(
      <ImageAttachment
        attachment={ARTIFACT_ATTACHMENT}
        onRemoveAttachment={onRemoveAttachment}
      />,
    );

    await user.click(getByLabelText('Remove attachment'));
    expect(getByRole('dialog')).toBeInTheDocument();

    const checkbox = getByRole('checkbox');
    await user.click(checkbox);
    await user.click(getByRole('button', { name: 'Delete' }));

    expect(onRemoveAttachment).toHaveBeenCalledWith('/my-bucket/folder/photo.png', true);
  });

  it('is also reachable from the full-size viewer\'s own delete button', async () => {
    const onRemoveAttachment = vi.fn();
    const user = userEvent.setup();

    const { getByRole, getAllByLabelText } = renderWithProviders(
      <ImageAttachment
        attachment={LEGACY_BASE64_ATTACHMENT}
        onRemoveAttachment={onRemoveAttachment}
      />,
    );

    await user.click(getByRole('button', { name: 'View attachment' }));
    const removeButtons = getAllByLabelText('Remove attachment');
    // One in the thumbnail overlay, one in the viewer header.
    expect(removeButtons.length).toBeGreaterThanOrEqual(2);
    await user.click(removeButtons[removeButtons.length - 1] as HTMLElement);

    await user.click(getByRole('button', { name: 'Delete' }));
    expect(onRemoveAttachment).toHaveBeenCalledWith('thumb.png', false);
  });
});
