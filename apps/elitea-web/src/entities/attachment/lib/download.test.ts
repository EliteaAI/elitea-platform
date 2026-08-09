import { afterEach, describe, expect, it, vi } from 'vitest';

import { server } from '@/test/setup';
import {
  artifactContentNetworkError,
  artifactContentNotFound,
  artifactContentOk,
} from '@/test/msw/handlers/artifacts';
import type { CapturedArtifactsRequest } from '@/test/msw/handlers/artifacts';

import { downloadAttachmentFromArtifact, downloadAttachmentImage } from './download';
import type { Attachment } from '../model/types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadAttachmentImage — attachment.helpers.js downloadAttachmentImage, narrowed to what needs no fetch/XMLHttpRequest (R-A1/R-A4)', () => {
  it('reports an error and never downloads when there is no image content at all', () => {
    const onError = vi.fn<(message: string) => void>();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    downloadAttachmentImage({}, onError);

    expect(onError).toHaveBeenCalledWith('Content not available for download');
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('downloads a File attachment directly via triggerBlobDownload — skips getImageSource, so only ONE object URL (triggerBlobDownload\'s own) is ever created', () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:triggered-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const file = new File(['file-bytes'], 'picked.png', { type: 'image/png' });
    const onError = vi.fn<(message: string) => void>();

    downloadAttachmentImage(file, onError);

    expect(onError).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Exactly 1 call — triggerBlobDownload's own — not 2 (getImageSource would have added a 2nd, unused, createObjectURL(file) call).
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(file);
  });

  it('decodes a data: URL to a Blob and triggers the download with the attachment name', async () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const onError = vi.fn<(message: string) => void>();
    // base64 for "hi"
    const attachment: Attachment = {
      item_details: {
        name: 'thumb.png',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } }],
      },
    };

    downloadAttachmentImage(attachment, onError);

    expect(onError).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const blobArg = createSpy.mock.calls[0]?.[0];
    if (!(blobArg instanceof Blob)) throw new Error('unreachable');
    expect(blobArg.type).toBe('image/png');
    await expect(blobArg.text()).resolves.toBe('hi');
  });

  it('defaults to image/jpeg when the data: URL carries no mime type', async () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const attachment: Attachment = {
      item_details: { content: [{ type: 'image_url', image_url: { url: 'data:;base64,aGk=' } }] },
    };

    downloadAttachmentImage(attachment, vi.fn<(message: string) => void>());

    const blobArg = createSpy.mock.calls[0]?.[0];
    if (!(blobArg instanceof Blob)) throw new Error('unreachable');
    expect(blobArg.type).toBe('image/jpeg');
    await expect(blobArg.text()).resolves.toBe('hi');
  });

  it('reports "Unsupported content format" for an already-resolved non-data: URL (disclosed gap — no fetch surface here)', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const onError = vi.fn<(message: string) => void>();
    const attachment: Attachment = {
      item_details: { content: [{ type: 'image_url', image_url: { url: 'https://example.com/original.png' } }] },
    };

    downloadAttachmentImage(attachment, onError);

    expect(onError).toHaveBeenCalledWith('Unsupported content format for download');
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('reports "Unsupported content format" for a bare string attachment', () => {
    const onError = vi.fn<(message: string) => void>();

    downloadAttachmentImage('https://example.com/direct.png', onError);

    expect(onError).toHaveBeenCalledWith('Unsupported content format for download');
  });
});

describe('downloadAttachmentFromArtifact — downloadFileFromArtifact-equivalent (composes S6 fetchArtifactBlob + triggerBlobDownload)', () => {
  it('parses /{bucket}/{filename}, fetches the artifact, and triggers the download with the basename', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const sink: CapturedArtifactsRequest[] = [];
    server.use(artifactContentOk(sink));
    const onError = vi.fn<(message: string) => void>();

    await downloadAttachmentFromArtifact({ baseUrl: '/api/v2', projectId: 'p1', filepath: '/my-bucket/folder/photo.png' }, onError);

    expect(onError).not.toHaveBeenCalled();
    const request = sink[0];
    if (request === undefined) throw new Error('unreachable');
    expect(new URL(request.url).pathname).toBe('/api/v2/artifacts/objects/p1/my-bucket/folder/photo.png');
  });

  it('reports an error for a filepath that does not start with "/"', async () => {
    const onError = vi.fn<(message: string) => void>();
    await downloadAttachmentFromArtifact({ baseUrl: '/api/v2', projectId: 'p1', filepath: 'bucket/a.png' }, onError);
    expect(onError).toHaveBeenCalledWith('Invalid filepath format: bucket/a.png');
  });

  it('reports an error for a filepath with no filename segment', async () => {
    const onError = vi.fn<(message: string) => void>();
    await downloadAttachmentFromArtifact({ baseUrl: '/api/v2', projectId: 'p1', filepath: '/bucket-only' }, onError);
    expect(onError).toHaveBeenCalledWith('Invalid filepath format: /bucket-only');
  });

  it('reports an HTTP failure from the artifact fetch', async () => {
    server.use(artifactContentNotFound());
    const onError = vi.fn<(message: string) => void>();

    await downloadAttachmentFromArtifact({ baseUrl: '/api/v2', projectId: 'p1', filepath: '/bucket/missing.png' }, onError);

    expect(onError).toHaveBeenCalledWith('Download error: HTTP 404');
  });

  it('reports a network failure from the artifact fetch', async () => {
    server.use(artifactContentNetworkError());
    const onError = vi.fn<(message: string) => void>();

    await downloadAttachmentFromArtifact({ baseUrl: '/api/v2', projectId: 'p1', filepath: '/bucket/a.png' }, onError);

    expect(onError).toHaveBeenCalledTimes(1);
    const [message]: [string] = onError.mock.calls[0] ?? [''];
    expect(message).toMatch(/^Download error: /);
  });
});
