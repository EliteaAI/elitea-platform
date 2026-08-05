/**
 * shared/api/upload.ts — spec §5.7 row 2 (unit S6): chunked chat-attachment
 * upload with progress. THE ONLY sanctioned `XMLHttpRequest` in the app
 * (R-A4) — `fetch` still cannot report upload progress, so this is §2.4's
 * one documented exception to "one hand-written fetch wrapper".
 *
 * Old location: apps/elitea-ui/src/hooks/chat/useUploadWithProgress.js.
 * `CHUNK_SIZE = 5 * 1024 * 1024` (old: :10). Endpoint (old: :52/:125):
 * `POST {VITE_SERVER_URL}/elitea_core/attachments/prompt_lib/{projectId}/{conversationId}`
 * — mounted under /api/v2 like every other `elitea_core` route, so (unlike
 * artifacts.ts rows 1/5) the base URL is used AS-IS, no /api/v2 strip.
 *
 * §3.6 discipline: every XHR outcome resolves to a `UploadResult`, never a
 * throw/reject — a deliberate deviation from the old app's Promise
 * reject()-on-failure shape (useUploadWithProgress.js:39/44/48/116/121),
 * matching the rest of this codebase's Result discipline (http.ts).
 */
import { resolveCredentialsMode } from './http';

export const CHUNK_SIZE = 5 * 1024 * 1024;

/* ── row 2a: pure chunk splitter ──────────────────────────────────────────── */

/**
 * BUG FIX, found while porting Wave-2 unit C1 (chat model/store): the old
 * app's `useUploadWithProgress.js:154` (this file's own direct baseline)
 * calls `normalizeFileExtension(file)` — from `[fsd]/entities/attachment/
 * lib/helpers/attachment.helpers.js:334-347` — BEFORE ever branching into
 * the small-file/chunked paths below, lowercasing only the file's
 * extension (`"photo.JPG"` -> `"photo.jpg"`, base name untouched). This
 * port never carried that step over, so an uppercase-extension upload
 * reaches the server under a different filename than the old app produced,
 * silently, with no caller-visible signal. Exact port of the same
 * substring logic.
 */
export function normalizeFileNameExtension(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === name.length - 1) return name;
  const baseName = name.slice(0, dotIndex);
  const ext = name.slice(dotIndex).toLowerCase();
  return baseName + ext;
}

/** File-object form of {@link normalizeFileNameExtension} — same lowercased-extension rewrite, applied to a real `File`'s own name. */
export function normalizeFileExtension(file: File): File {
  const normalizedName = normalizeFileNameExtension(file.name);
  if (normalizedName === file.name) return file;
  return new File([file], normalizedName, { type: file.type, lastModified: file.lastModified });
}

/** Exact port of useUploadWithProgress.js:65-76's `createFileChunks`. */
export function createFileChunks(file: Blob): Blob[] {
  const chunks: Blob[] = [];
  let start = 0;
  while (start < file.size) {
    const end = Math.min(start + CHUNK_SIZE, file.size);
    chunks.push(file.slice(start, end));
    start = end;
  }
  return chunks;
}

/* ── row 2b: chunk-ack response normalisation ─────────────────────────────── */

export type ChunkAckResult =
  | { readonly status: 'in_progress' }
  | { readonly status: 'complete'; readonly data: unknown };

/**
 * Exact port of useUploadWithProgress.js:107-118's response normalisation —
 * `JSON.parse(xhr.responseText); resolve(response[0] ?? { in_progress: true })`.
 * ANY response that is not a non-empty array (including a literal
 * `{ in_progress: true }` object, which has no `[0]`) is treated as an
 * in-progress ack — a deliberately preserved old-app quirk (any unexpected
 * non-array 2xx body reads as "still uploading"), not something S6 is scoped
 * to fix. A body that fails `JSON.parse` is treated as 'complete' with no
 * payload, matching the old app's `{ sucess: true }` typo'd catch-fallback
 * (useUploadWithProgress.js:113) — that fallback also lacked `in_progress`,
 * so the caller (:203) already treated it as final; the typo itself is not
 * reproduced since the new type is a proper discriminated union, not a wire
 * literal.
 */
export function parseChunkAck(responseText: string): ChunkAckResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return { status: 'complete', data: undefined };
  }
  const first: unknown = Array.isArray(parsed) ? parsed[0] : undefined;
  return first === undefined || first === null ? { status: 'in_progress' } : { status: 'complete', data: first };
}

/** Exact port of useUploadWithProgress.js:30-37's single-shot response parse (`response[0]`, `null` on parse failure). */
export function parseSmallFileAck(responseText: string): unknown {
  try {
    const parsed: unknown = JSON.parse(responseText);
    const first: unknown = Array.isArray(parsed) ? parsed[0] : undefined;
    return first ?? null;
  } catch {
    return null;
  }
}

/* ── shared XHR core ──────────────────────────────────────────────────────── */

type UploadFailure =
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'network' }
  | { readonly kind: 'aborted' };

export type UploadResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: UploadFailure };

/** Exact port of useUploadWithProgress.js:51-52/124-125's URL — /api/v2 NOT stripped (see module doc). */
export function buildAttachmentUploadUrl(baseUrl: string, projectId: string, conversationId: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/elitea_core/attachments/prompt_lib/${encodeURIComponent(projectId)}/${encodeURIComponent(conversationId)}`;
}

interface XhrUploadSpec {
  readonly url: string;
  readonly formData: FormData;
  readonly credentials: boolean;
  // `| undefined` explicit (not just `?:`) so callers can forward an already-
  // optional field straight through under exactOptionalPropertyTypes without
  // an extra conditional-spread branch at every call site.
  readonly devToken?: string | undefined;
  readonly onProgress?: ((loaded: number, total: number) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * The one place `new XMLHttpRequest()` is constructed. Wires
 * `xhr.upload.onprogress` to `onProgress` (row 2's progress-callback
 * requirement), sends the 5 chunk fields the caller already built into
 * `formData`, and NEVER rejects — every outcome resolves an `UploadResult`.
 */
function sendUpload(spec: XhrUploadSpec): Promise<UploadResult<string>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const onAbortSignal = (): void => xhr.abort();
    const finish = (result: UploadResult<string>): void => {
      if (settled) return;
      settled = true;
      spec.signal?.removeEventListener('abort', onAbortSignal);
      resolve(result);
    };
    // Shared by BOTH the pre-abort short-circuit below and the xhr 'abort'
    // event listener — one function, two triggers (a signal aborted before
    // send(), or the underlying request aborted while in flight).
    const finishAborted = (): void => finish({ ok: false, error: { kind: 'aborted' } });

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) spec.onProgress?.(event.loaded, event.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        finish({ ok: true, data: xhr.responseText });
      } else {
        finish({ ok: false, error: { kind: 'http', status: xhr.status } });
      }
    });
    xhr.addEventListener('error', () => finish({ ok: false, error: { kind: 'network' } }));
    xhr.addEventListener('abort', finishAborted);

    if (spec.signal?.aborted === true) {
      finishAborted();
      return;
    }

    xhr.open('POST', spec.url);
    xhr.withCredentials = spec.credentials;
    if (import.meta.env.DEV) {
      if (spec.devToken !== undefined && spec.devToken !== '') xhr.setRequestHeader('Authorization', `Bearer ${spec.devToken}`);
      xhr.setRequestHeader('Cache-Control', 'no-cache');
    }
    spec.signal?.addEventListener('abort', onAbortSignal);
    xhr.send(spec.formData);
  });
}

function credentialsFor(baseUrl: string): boolean {
  return resolveCredentialsMode(baseUrl, window.location.origin) === 'include';
}

/* ── row 2c: chunk + small-file senders ───────────────────────────────────── */

export interface UploadChunkParams {
  readonly baseUrl: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly chunk: Blob;
  readonly chunkIndex: number;
  readonly totalChunks: number;
  readonly fileId: string;
  readonly fileName: string;
  // `| undefined` explicit so uploadFileWithProgress can forward its own
  // (already-optional) fields straight through under exactOptionalPropertyTypes.
  readonly devToken?: string | undefined;
  readonly onProgress?: ((loaded: number, total: number) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Sends one chunk. Fields (spec §5.7 row 2, exact old names):
 * `file`, `chunk_index`, `total_chunks`, `file_id`, `file_name`,
 * `overwrite_attachments=1` (old: useUploadWithProgress.js:93-98).
 */
export async function uploadChunk(params: UploadChunkParams): Promise<UploadResult<ChunkAckResult>> {
  const formData = new FormData();
  formData.append('file', params.chunk);
  formData.append('chunk_index', String(params.chunkIndex));
  formData.append('total_chunks', String(params.totalChunks));
  formData.append('file_id', params.fileId);
  formData.append('file_name', params.fileName);
  formData.append('overwrite_attachments', '1');

  const url = buildAttachmentUploadUrl(params.baseUrl, params.projectId, params.conversationId);
  const outcome = await sendUpload({
    url,
    formData,
    credentials: credentialsFor(params.baseUrl),
    devToken: params.devToken,
    onProgress: params.onProgress,
    signal: params.signal,
  });
  if (!outcome.ok) return outcome;
  return { ok: true, data: parseChunkAck(outcome.data) };
}

export interface UploadSmallFileParams {
  readonly baseUrl: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly file: Blob;
  // `| undefined` explicit — see UploadChunkParams for why.
  readonly devToken?: string | undefined;
  readonly onProgress?: ((loaded: number, total: number) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** Single-shot upload for files <= CHUNK_SIZE (old: useUploadWithProgress.js:16-63). Fields: `file`, `overwrite_attachments=1`. */
export async function uploadSmallFile(params: UploadSmallFileParams): Promise<UploadResult<unknown>> {
  const formData = new FormData();
  // See normalizeFileExtension's own doc comment — real `File` callers get
  // the same lowercased-extension rewrite the old app applied upfront;
  // a plain non-File `Blob` has no filename to normalize.
  formData.append('file', params.file instanceof File ? normalizeFileExtension(params.file) : params.file);
  formData.append('overwrite_attachments', '1');

  const url = buildAttachmentUploadUrl(params.baseUrl, params.projectId, params.conversationId);
  const outcome = await sendUpload({
    url,
    formData,
    credentials: credentialsFor(params.baseUrl),
    devToken: params.devToken,
    onProgress: params.onProgress,
    signal: params.signal,
  });
  if (!outcome.ok) return outcome;
  return { ok: true, data: parseSmallFileAck(outcome.data) };
}

/* ── row 2d: whole-file orchestrator (small-file vs. chunked) ─────────────── */

export interface UploadFileWithProgressParams {
  readonly baseUrl: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly file: Blob;
  readonly fileName: string;
  /** Caller-supplied (old app: `uuidv4()`, useUploadWithProgress.js:178 — id generation is not this module's concern). */
  readonly fileId: string;
  readonly devToken?: string;
  /** Called with (bytes uploaded so far, total file bytes) — aggregated across all chunks (parity: useUploadWithProgress.js:193-198). */
  readonly onProgress?: (loaded: number, total: number) => void;
  readonly signal?: AbortSignal;
}

/**
 * Decides small-file vs. chunked (old: useUploadWithProgress.js:159-208) and
 * drives either path to completion, aggregating byte-level progress across
 * chunks. Returns the last non-in_progress chunk ack's `data` for the
 * chunked path (parity: `groupedChunksFile`, :182/203/208).
 */
export async function uploadFileWithProgress(params: UploadFileWithProgressParams): Promise<UploadResult<unknown>> {
  const totalBytes = params.file.size;
  if (totalBytes <= CHUNK_SIZE) {
    // `params.file`/`params.fileName` are separate fields (unlike the old
    // app's single `File`) — build a real File carrying the NORMALIZED
    // name explicitly, rather than relying on `uploadSmallFile`'s own
    // File-instance check (which would silently no-op for a plain Blob).
    const namedFile = new File([params.file], normalizeFileNameExtension(params.fileName), {
      type: params.file.type,
    });
    return uploadSmallFile({
      baseUrl: params.baseUrl,
      projectId: params.projectId,
      conversationId: params.conversationId,
      file: namedFile,
      devToken: params.devToken,
      onProgress: params.onProgress,
      signal: params.signal,
    });
  }

  const chunks = createFileChunks(params.file);
  const totalChunks = chunks.length;
  let uploadedBytes = 0;
  let finalData: unknown;

  for (let index = 0; index < totalChunks; index++) {
    const chunk = chunks[index];
    if (chunk === undefined) continue;
    const bytesBeforeThisChunk = uploadedBytes;
    const outcome = await uploadChunk({
      baseUrl: params.baseUrl,
      projectId: params.projectId,
      conversationId: params.conversationId,
      chunk,
      chunkIndex: index,
      totalChunks,
      fileId: params.fileId,
      fileName: normalizeFileNameExtension(params.fileName),
      onProgress: (loaded) => params.onProgress?.(bytesBeforeThisChunk + loaded, totalBytes),
      devToken: params.devToken,
      signal: params.signal,
    });
    if (!outcome.ok) return outcome;
    uploadedBytes += chunk.size;
    if (outcome.data.status === 'complete') finalData = outcome.data.data;
  }

  return { ok: true, data: finalData };
}
