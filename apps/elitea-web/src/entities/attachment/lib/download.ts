/**
 * Attachment download side effects — `lib/` (impure: DOM, and — via
 * `fetchArtifactBlob` — the network), not `model/` (pure selectors), per
 * this codebase's model=pure/lib=impure convention. Neither export calls
 * `fetch`/`XMLHttpRequest` directly (both are architecturally fenced out of
 * `entities/**`, R-A1/R-A4) — `downloadAttachmentFromArtifact` reaches the
 * network only through S6's already-sanctioned `fetchArtifactBlob`.
 */
import { fetchArtifactBlob } from '@/shared/api/artifacts';
import type { HttpFailure } from '@/shared/api/http';
import { triggerBlobDownload } from '@/shared/lib/download';

import { getAttachmentName, getImageSource } from '../model/selectors';
import type { Attachment } from '../model/types';

/** attachment.helpers.js:95-109 `createBlobFromBase64`, ported verbatim (the byte loop writes straight into the `Uint8Array` instead of through an intermediate `Array` — same bytes, no otherwise-pointless allocation). */
function blobFromDataUrl(dataUrl: string, defaultMimeType: string): Blob {
  const [header, base64Body] = dataUrl.split(',');
  const byteCharacters = window.atob(base64Body ?? '');
  const byteArray = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteArray[i] = byteCharacters.charCodeAt(i);
  }
  const mimeType = header?.split(';')[0]?.split(':')[1];
  return new Blob([byteArray], { type: mimeType !== undefined && mimeType !== '' ? mimeType : defaultMimeType });
}

/**
 * attachment.helpers.js's `downloadAttachmentImage`, narrowed to exactly the
 * paths this slice can serve WITHOUT calling `fetch`/`XMLHttpRequest` — both
 * are architecturally fenced out of `entities/**` (R-A1: "fetch is called
 * only inside shared/api/http.ts" plus the two S6 carve-outs,
 * shared/api/artifacts.ts and shared/lib/download.ts, neither of which fits
 * an arbitrary attachment URL; R-A4 fences `XMLHttpRequest` the same way).
 * Two real, network-free cases, plus one disclosed gap:
 *  - `attachment instanceof File`: downloaded DIRECTLY (a `File` already IS
 *    a `Blob`) via `triggerBlobDownload`. Simpler than, and behaviourally
 *    equivalent to, the baseline's own round-trip
 *    (`getImageSource`'s `URL.createObjectURL(attachment)` -> baseline's
 *    `downloadAttachment` -> `fetch(that blob: URL)` -> `Blob` again) —
 *    skips `getImageSource` entirely for this branch, so only the ONE
 *    object URL `triggerBlobDownload` itself creates-and-revokes ever
 *    exists, instead of that plus a second, wasted one from
 *    `getImageSource`.
 *  - a `data:` URL (legacy base64-embedded image, pre-OOM-fix format):
 *    decoded to a `Blob` and downloaded via `triggerBlobDownload` — again
 *    simpler than the baseline's `Blob -> createObjectURL -> fetch(that
 *    blob: URL) -> Blob -> createObjectURL -> anchor-click` round-trip
 *    (`downloadFromBase64` -> `downloadFromUrl` -> `downloadFile`), which
 *    re-fetches the very `blob:` URL it just created for no observable
 *    benefit.
 *  - DEVIATION (disclosed, real regression vs. the baseline): any OTHER
 *    resolved `string` content (a plain already-resolved remote URL, e.g. a
 *    non-`data:`/non-`filepath:` `image_url.url`) has no sanctioned fetch
 *    surface inside `entities/attachment` and is reported as unsupported
 *    rather than downloaded. Per the baseline's own comment on
 *    `getImageSource` ("Skip unresolved filepath: URLs — they are internal
 *    references resolved by the indexer at predict time and replaced with
 *    data: thumbnail URLs"), a persisted image attachment's resolved URL is
 *    always either `data:` or (filtered out already) `filepath:` — this
 *    branch is believed unreachable on real data, not exercised in
 *    practice, but is a genuine capability gap versus the baseline's
 *    `downloadFile`-backed fallback if it ever is reached.
 */
export function downloadAttachmentImage(attachment: Attachment, onError: (message: string) => void): void {
  const fileName = getAttachmentName(attachment);

  if (attachment instanceof File) {
    triggerBlobDownload(attachment, fileName);
    return;
  }

  const content = getImageSource(attachment);
  if (content === null) {
    onError('Content not available for download');
    return;
  }

  if (!content.startsWith('data:')) {
    onError('Unsupported content format for download');
    return;
  }

  try {
    triggerBlobDownload(blobFromDataUrl(content, 'image/jpeg'), fileName);
  } catch (error) {
    onError(`Failed to process base64 data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function describeArtifactFetchFailure(failure: HttpFailure): string {
  switch (failure.kind) {
    case 'http':
      return `HTTP ${String(failure.status)}`;
    case 'auth':
      return 'Authentication is required to download this file.';
    case 'network':
      return failure.message;
    case 'aborted':
      return 'The download was cancelled.';
    default:
      return failure satisfies never;
  }
}

/** `/{bucket}/{filename}` -> `{bucket, filename}` — old app: `parseFilepath`, common/utils.jsx:359-370. Returns `null` on malformed input instead of throwing (§3.6). */
function parseAttachmentFilepath(filepath: string): { readonly bucket: string; readonly filename: string } | null {
  if (!filepath.startsWith('/')) return null;
  const parts = filepath.slice(1).split('/');
  const bucket = parts[0];
  const filename = parts.slice(1).join('/');
  if (bucket === undefined || bucket === '' || filename === '') return null;
  return { bucket, filename };
}

export interface DownloadAttachmentFromArtifactParams {
  /** config.vite_server_url — forwarded to `fetchArtifactBlob` as-is (that function does its own /api/v2 handling). */
  readonly baseUrl: string;
  readonly projectId: string;
  /** `/{bucket}/{filename}` — old app: `item_details.filepath`. */
  readonly filepath: string;
  readonly devToken?: string;
  readonly signal?: AbortSignal;
}

/**
 * Fetches an attachment's ORIGINAL file from artifact storage and triggers
 * a browser download — the `downloadFileFromArtifact`-equivalent wrapper
 * the sibling `ImageAttachment.jsx` cluster's `onClickDown` non-base64
 * branch needs (old app: `common/utils.jsx:405-436`'s
 * `downloadFileFromArtifact({projectId, filepath, handleError})`, called
 * directly at [fsd]/features/chat/ui/chat-attachment/ImageAttachment.jsx:
 * 66-72 whenever `item_details.filepath` is set). NOT part of the 5
 * functions this unit's brief named explicitly — added because the brief
 * also invited "a clean small addition" here for exactly this gap, and this
 * one composes two already-existing, already-reviewed S6 primitives
 * (`fetchArtifactBlob` + `triggerBlobDownload`) rather than introducing any
 * new fetch/auth logic of its own.
 */
export async function downloadAttachmentFromArtifact(
  params: DownloadAttachmentFromArtifactParams,
  onError: (message: string) => void,
): Promise<void> {
  const parsed = parseAttachmentFilepath(params.filepath);
  if (parsed === null) {
    onError(`Invalid filepath format: ${params.filepath}`);
    return;
  }

  const result = await fetchArtifactBlob({
    baseUrl: params.baseUrl,
    projectId: params.projectId,
    bucket: parsed.bucket,
    filePath: parsed.filename,
    devToken: params.devToken,
    signal: params.signal,
  });

  if (!result.ok) {
    onError(`Download error: ${describeArtifactFetchFailure(result.error)}`);
    return;
  }

  triggerBlobDownload(result.data, parsed.filename.split('/').pop() ?? parsed.filename);
}
