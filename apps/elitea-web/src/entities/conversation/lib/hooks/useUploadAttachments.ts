import { useCallback, useState } from 'react';

import { uploadFileWithProgress, type UploadResult } from '@/shared/api/upload';

/**
 * Thin wrapper port of `apps/elitea-ui/src/hooks/chat/useUploadAttachments.js`
 * (unit C1) — chunked-upload-with-progress for chat message attachments.
 * Calls `shared/api/upload.ts`'s ALREADY-BUILT `uploadFileWithProgress`
 * (unit S6: chunking, XHR, progress, `UploadResult` discipline all live
 * there — none of it is reimplemented here), one file at a time, aggregating
 * per-file + overall progress.
 *
 * `baseUrl`/`devToken` are caller-supplied parameters, not resolved
 * internally — matching every other caller-supplied-baseUrl transport in
 * this codebase (`entities/canvas/api/canvasApi.ts`'s own
 * `UploadAttachmentsParams` doc comment, `shared/api/upload.ts`'s own
 * params).
 *
 * **Disclosed scope cuts vs. the baseline** (real gaps, not silently
 * dropped):
 *  - GA analytics (`useTrackEvent`/`GA_EVENT_NAMES.ATTACHMENT_UPLOADED`) —
 *    this app has no analytics module anywhere yet (same one-line gap the
 *    C1 brief itself calls out for `useCreateConversation.js`). Dropped.
 *  - The baseline additionally reshapes the caller's `messages` array,
 *    splicing a `message_items[]` attachment entry onto the first message
 *    (`useUploadAttachments.js:67-115`). That is message-DOMAIN
 *    construction (`entities/message`'s concern), which `entities/
 *    conversation` has no legal import path to (`no-sideways-entities`).
 *    This hook returns the per-file upload outcome (sanitized name +
 *    `filepath`) instead; the caller (a future message-composing unit)
 *    builds its own `message_items` entries from that.
 *  - `useChatConfig()`'s `limits.DEFAULT_MAX_FILE_SIZE` (client-side
 *    pre-upload size validation) — no `useChatConfig` hook exists in this
 *    app yet (only the generated `useGetChatConfig` query); a caller that
 *    wants size validation should read the config query itself and filter
 *    `attachments` before calling `uploadAttachments`.
 */

export interface UploadAttachmentsParams {
  readonly baseUrl: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly attachments: readonly File[];
  readonly devToken?: string;
}

/** One file's upload outcome — sanitized name/filepath come from the backend's response (baseline: `uploadedInfo.filepath`/`uploadedInfo.name`). */
export interface UploadedAttachment {
  readonly file: File;
  readonly filepath: string | undefined;
  readonly sanitizedName: string;
  readonly data: unknown;
}

export type UploadAttachmentsOutcome =
  | { readonly success: true; readonly uploaded: readonly UploadedAttachment[] }
  | { readonly success: false; readonly uploaded: readonly UploadedAttachment[]; readonly failedFile: File };

export interface UseUploadAttachmentsResult {
  readonly uploadAttachments: (params: UploadAttachmentsParams) => Promise<UploadAttachmentsOutcome>;
  readonly uploadingAttachments: readonly File[];
  readonly isUploading: boolean;
  readonly uploadProgress: number;
}

function sanitizedNameFrom(data: unknown, fallback: string): { readonly filepath: string | undefined; readonly sanitizedName: string } {
  const filepath = typeof data === 'object' && data !== null && 'filepath' in data ? (data as { filepath?: unknown }).filepath : undefined;
  if (typeof filepath === 'string' && filepath !== '') {
    return { filepath, sanitizedName: filepath.split('/').pop() ?? fallback };
  }
  return { filepath: undefined, sanitizedName: fallback };
}

export function useUploadAttachments(): UseUploadAttachmentsResult {
  const [uploadingAttachments, setUploadingAttachments] = useState<readonly File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const uploadAttachments = useCallback(async (params: UploadAttachmentsParams): Promise<UploadAttachmentsOutcome> => {
    const { baseUrl, projectId, conversationId, attachments, devToken } = params;
    if (attachments.length === 0) return { success: true, uploaded: [] };

    setIsUploading(true);
    setUploadingAttachments(attachments);
    setUploadProgress(0);

    const uploaded: UploadedAttachment[] = [];
    let failure: { readonly file: File } | undefined;

    for (const file of attachments) {
      // eslint-disable-next-line no-await-in-loop -- sequential by design, matching `entities/canvas/api/canvasApi.ts`'s own `uploadAttachments`: each upload must resolve before the next starts, there is no batched endpoint.
      const outcome: UploadResult<unknown> = await uploadFileWithProgress({
        baseUrl,
        projectId,
        conversationId,
        file,
        fileName: file.name,
        fileId: crypto.randomUUID(),
        ...(devToken !== undefined ? { devToken } : {}),
        onProgress: (loaded, total) => setUploadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0),
      });
      if (!outcome.ok) {
        failure = { file };
        break;
      }
      const { filepath, sanitizedName } = sanitizedNameFrom(outcome.data, file.name);
      uploaded.push({ file, filepath, sanitizedName, data: outcome.data });
    }

    setIsUploading(false);
    setUploadingAttachments([]);
    return failure ? { success: false, uploaded, failedFile: failure.file } : { success: true, uploaded };
  }, []);

  return { uploadAttachments, uploadingAttachments, isUploading, uploadProgress };
}
