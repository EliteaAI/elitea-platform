/**
 * shared/api/artifacts.ts — spec §5.7 rows 1, 3, 5 (unit S6): the artifacts/
 * S3-proxy transports that cannot go through `createHttpClient` (F4's
 * http.ts) because they need a raw `Blob` request/response body and, for
 * rows 1/5, a base URL with `/api/v2` STRIPPED — the opposite of http.ts's
 * contract, which always targets `/api/v2`. See the `.oxlintrc.json`
 * override comment on this path for why `fetch` is sanctioned here (R-A1).
 *
 * Routing fact this file exists to get right (verified against
 * services/elitea-main/internal/api/router.go, 2026-07-27):
 *   - router.go:165-169 mounts `/artifacts/s3/*` at ROOT LEVEL, before the
 *     `/api/v2` group — "S3-compatible artifacts API (root level — UI
 *     fetches via raw fetch, not baseQuery)" per the Go comment itself.
 *     Rows 1 (S3 direct PUT) and 5 (bucket/artifact list) target this group.
 *   - router.go:593-605 mounts `/artifacts/artifact/default/...` INSIDE the
 *     `/api/v2` route group (ArtifactHandler.GetArtifact/ServeFile). Row 3
 *     (artifact content blob) targets this group and must NOT strip
 *     `/api/v2` — `stripBaseUrlSuffix` with no `suffix` argument is a
 *     trailing-slash-only normalisation for exactly this reason.
 */
import { resolveCredentialsMode } from './http';
import type { HttpFailure, HttpResult } from './http';

/* ── base-URL prefix stripping (row 1 + row 5's "un-prefixed path") ──────── */

export const API_V2_SUFFIX = '/api/v2';

/**
 * Exact port of the old app's `clearBaseUrlPrefix` (common/utils.jsx:26-33),
 * INCLUDING its literal (non-anchored) `String.prototype.replace` quirk:
 * when `suffix` is given, only the FIRST occurrence is removed (not
 * necessarily at the end of the string) — `suffix` is matched as a plain
 * substring, not anchored. Trailing slashes are always stripped afterward.
 * Preserved verbatim rather than "fixed" because it is the exact function
 * the old app's callers relied on; VITE_SERVER_URL is deployment-controlled
 * and never contains `/api/v2` as a coincidental substring elsewhere, so the
 * quirk is inert in practice but kept for byte-for-byte parity.
 */
export function stripBaseUrlSuffix(url: string, suffix?: string): string {
  let result = url;
  if (suffix !== undefined && suffix !== '') {
    result = url.endsWith('/') ? url.replace(`${suffix}/`, '') : url.replace(suffix, '');
  }
  return result.replace(/\/+$/, '');
}

/** `stripBaseUrlSuffix(url, '/api/v2')` — rows 1/5's root-level base. */
export function stripApiV2Prefix(url: string): string {
  return stripBaseUrlSuffix(url, API_V2_SUFFIX);
}

/* ── shared plumbing ──────────────────────────────────────────────────────── */

/** Exact port of the per-segment encoding in slices/upload.js:100-103. */
function encodeKeySegments(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Dev bearer + no-cache, gated by import.meta.env.DEV — parity with
 * http.ts's behaviour 6 (statically eliminated from production bundles).
 */
function devHeaders(devToken?: string): Headers {
  const headers = new Headers();
  if (import.meta.env.DEV) {
    if (devToken !== undefined && devToken !== '') headers.set('Authorization', `Bearer ${devToken}`);
    headers.set('Cache-Control', 'no-cache');
  }
  return headers;
}

/**
 * Old app's credentials handling across these near-identical fetches was
 * inconsistent: slices/upload.js:117's axios PUT sets `withCredentials:true`
 * unconditionally; utils.jsx:390's fetchArtifactBlobUrl and utils.jsx:508's
 * downloadArtifactsAsZip set no credentials option at all (default
 * 'same-origin'); useArtifactContentFetch.hooks.js:84 sets 'include'
 * explicitly. Applying F4's dynamic cross-origin rule (§5.4 behaviour 1)
 * uniformly here both preserves 'include' at the site that had it and closes
 * the silent-cookie-drop gap at the sites that didn't — the same rationale
 * http.ts itself is built on.
 */
function credentialsFor(resolvedBaseUrl: string): RequestCredentials {
  return resolveCredentialsMode(resolvedBaseUrl, window.location.origin);
}

function isAbortError(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { name?: unknown }).name === 'AbortError';
}

function networkFailure(cause: unknown, url: string): HttpFailure {
  if (isAbortError(cause)) return { kind: 'aborted', url };
  const message = cause instanceof Error ? cause.message : String(cause);
  return { kind: 'network', url, message: `artifacts: request to ${url} failed: ${message}`, cause };
}

/** Body-parsing twin of http.ts's toResult, for JSON-returning endpoints. */
async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Handled (§3.6): a non-JSON body is surfaced as raw text, not a crash.
    return text;
  }
}

async function toJsonResult(response: Response): Promise<HttpResult<unknown>> {
  const data = await parseJsonBody(response);
  if (!response.ok) {
    return { ok: false, error: { kind: 'http', status: response.status, url: response.url, body: data } };
  }
  return { ok: true, status: response.status, data, headers: response.headers };
}

async function toBlobResult(response: Response): Promise<HttpResult<Blob>> {
  if (!response.ok) {
    const body = await parseJsonBody(response);
    return { ok: false, error: { kind: 'http', status: response.status, url: response.url, body } };
  }
  return { ok: true, status: response.status, data: await response.blob(), headers: response.headers };
}

/* ── row 1: S3 direct PUT ─────────────────────────────────────────────────── */

export interface PutArtifactToS3Params {
  /** config.vite_server_url, e.g. '/api/v2' — has /api/v2 stripped before use. */
  readonly baseUrl: string;
  /** e.g. '/artifacts/s3/{bucket}' (old app: the `url` arg to uploadFile, features/artifacts/lib/hooks/useFileUpload.hooks.js:140-145). */
  readonly s3Path: string;
  /** Unencoded; may contain '/' for a folder path — each segment is encoded separately. */
  readonly fileKey: string;
  readonly projectId: string;
  readonly file: Blob;
  readonly contentType?: string;
  readonly devToken?: string;
  readonly signal?: AbortSignal;
}

/** Exact port of slices/upload.js:107-108's URL assembly. */
export function buildS3UploadUrl(baseUrl: string, s3Path: string, fileKey: string, projectId: string): string {
  const base = stripApiV2Prefix(baseUrl);
  const query = new URLSearchParams({ project_id: projectId });
  return `${base}${s3Path}/${encodeKeySegments(fileKey)}?${query.toString()}`;
}

/**
 * S3 direct PUT (old: slices/upload.js:117's `axios.put`). Uses `fetch`, not
 * axios (R-A2). NOTE (parity gap, flagged for review): `fetch` cannot report
 * upload progress the way `axios`'s `onUploadProgress` did — the per-file
 * progress bar `useFileUpload`'s old counterpart drove is not reproducible
 * here. §2.4 sanctions XMLHttpRequest for upload progress only in
 * `shared/api/upload.ts` (the chunked-attachment path); the S3 bucket-upload
 * path was not included in that carve-out, so this is a genuine, spec-level
 * regression versus the old app, not an S6 implementation gap.
 */
export async function putArtifactToS3(params: PutArtifactToS3Params): Promise<HttpResult<void>> {
  const url = buildS3UploadUrl(params.baseUrl, params.s3Path, params.fileKey, params.projectId);
  const headers = devHeaders(params.devToken);
  // Parity: slices/upload.js:110 — `normalizedFile.type || 'application/octet-stream'`.
  headers.set('Content-Type', params.contentType !== undefined && params.contentType !== '' ? params.contentType : (params.file.type !== '' ? params.file.type : 'application/octet-stream'));
  const credentials = credentialsFor(stripApiV2Prefix(params.baseUrl));

  let response: Response;
  try {
    response = await fetch(url, { method: 'PUT', headers, body: params.file, credentials, signal: params.signal ?? null });
  } catch (cause) {
    return { ok: false, error: networkFailure(cause, url) };
  }
  if (!response.ok) {
    const body = await parseJsonBody(response);
    return { ok: false, error: { kind: 'http', status: response.status, url: response.url, body } };
  }
  return { ok: true, status: response.status, data: undefined, headers: response.headers };
}

/* ── row 5: bucket / artifact list (root-level, no /api/v2) ──────────────── */

export interface ListBucketsParams {
  readonly baseUrl: string;
  readonly projectId: string;
  readonly signal?: AbortSignal;
}

/**
 * NOT an exact port — a deliberate generalization of api/artifacts.js:25-29's
 * bucketList URL. The old code builds a BARE relative URL
 * (`` `/artifacts/s3/?${params}` ``) with no base-URL computation of any kind
 * — no VITE_SERVER_URL, no clearBaseUrlPrefix call — relying entirely on the
 * browser resolving it against the page's own origin. This version instead
 * computes `stripApiV2Prefix(baseUrl)` from `config.vite_server_url` and
 * prepends it explicitly. The two are only OBSERVABLY equivalent when
 * `VITE_SERVER_URL`'s origin matches the page's own origin (true for the
 * pinned same-origin baseline deployment, but not guaranteed by the config
 * contract — the same cross-origin scenario `credentialsFor` above already
 * treats as real). Still produces the same un-prefixed `/artifacts/s3/...`
 * path either way (row 5's actual requirement).
 */
export function buildBucketListUrl(baseUrl: string, projectId: string): string {
  const base = stripApiV2Prefix(baseUrl);
  const query = new URLSearchParams({ project_id: projectId, format: 'json' });
  return `${base}/artifacts/s3/?${query.toString()}`;
}

export async function listBuckets(params: ListBucketsParams): Promise<HttpResult<unknown>> {
  const url = buildBucketListUrl(params.baseUrl, params.projectId);
  const credentials = credentialsFor(stripApiV2Prefix(params.baseUrl));
  let response: Response;
  try {
    response = await fetch(url, { credentials, signal: params.signal ?? null });
  } catch (cause) {
    return { ok: false, error: networkFailure(cause, url) };
  }
  return toJsonResult(response);
}

export interface ListArtifactsParams {
  readonly baseUrl: string;
  readonly projectId: string;
  readonly bucket: string;
  readonly signal?: AbortSignal;
}

/**
 * NOT an exact port — a deliberate generalization of api/artifacts.js:82-86's
 * artifactList URL, same rationale as `buildBucketListUrl` above: the old
 * code builds a BARE relative URL with no base-URL computation at all, while
 * this version explicitly prepends `stripApiV2Prefix(baseUrl)`, which is
 * only observably equivalent when the configured base URL's origin matches
 * the page's own origin. `encodeURI` (not `encodeURIComponent`) on the
 * bucket IS an exact match to the old call site, though — that part is a
 * literal port.
 */
export function buildArtifactListUrl(baseUrl: string, projectId: string, bucket: string): string {
  const base = stripApiV2Prefix(baseUrl);
  const query = new URLSearchParams({ project_id: projectId, format: 'json' });
  return `${base}/artifacts/s3/${encodeURI(bucket)}?${query.toString()}`;
}

export async function listArtifacts(params: ListArtifactsParams): Promise<HttpResult<unknown>> {
  const url = buildArtifactListUrl(params.baseUrl, params.projectId, params.bucket);
  const credentials = credentialsFor(stripApiV2Prefix(params.baseUrl));
  let response: Response;
  try {
    response = await fetch(url, { credentials, signal: params.signal ?? null });
  } catch (cause) {
    return { ok: false, error: networkFailure(cause, url) };
  }
  return toJsonResult(response);
}

/* ── row 3: artifact blob fetch + ZIP multi-download ──────────────────────── */

export interface FetchArtifactBlobParams {
  /** config.vite_server_url, used AS-IS (no /api/v2 strip — this endpoint IS under /api/v2). */
  readonly baseUrl: string;
  readonly projectId: string;
  readonly bucket: string;
  /** May contain '/' for a nested path; encoded as one component (parity: useArtifactContentFetch.hooks.js:72 encodes the whole remainder). */
  readonly filePath: string;
  // `| undefined` explicit so downloadArtifactsAsZip can forward its own
  // (already-optional) fields straight through under exactOptionalPropertyTypes.
  readonly devToken?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** Exact port of utils.jsx:386 / useArtifactContentFetch.hooks.js:72's URL — /api/v2 NOT stripped. */
export function buildArtifactContentUrl(baseUrl: string, projectId: string, bucket: string, filePath: string): string {
  const base = stripBaseUrlSuffix(baseUrl);
  return `${base}/artifacts/artifact/default/${encodeURIComponent(projectId)}/${encodeURIComponent(bucket)}/${encodeURIComponent(filePath)}`;
}

/**
 * Unifies utils.jsx:386-406's `fetchArtifactBlobUrl` and
 * useArtifactContentFetch.hooks.js:69-108's fetch — both hit this exact
 * endpoint. `credentials` is resolved dynamically (see `credentialsFor`
 * above), which both preserves and generalises the hook's explicit
 * `credentials: 'include'` (hooks.js:84).
 */
export async function fetchArtifactBlob(params: FetchArtifactBlobParams): Promise<HttpResult<Blob>> {
  const url = buildArtifactContentUrl(params.baseUrl, params.projectId, params.bucket, params.filePath);
  const headers = devHeaders(params.devToken);
  const credentials = credentialsFor(stripBaseUrlSuffix(params.baseUrl));
  let response: Response;
  try {
    response = await fetch(url, { headers, credentials, signal: params.signal ?? null });
  } catch (cause) {
    return { ok: false, error: networkFailure(cause, url) };
  }
  return toBlobResult(response);
}

/**
 * Structural interface for a ZIP archiver — deliberately NOT a dependency on
 * the `jszip` package (old: utils.jsx:497 `const JSZip = (await
 * import('jszip')).default`). `jszip` is not in this app's dependency set
 * yet (package.json is unit F1's exclusive file; S6 must not touch it) — the
 * caller (the Wave-2 feature that wires the real download button) injects a
 * `JSZip` instance, which already satisfies this shape, or any equivalent.
 */
export interface ZipArchiver {
  file(path: string, data: Blob): void;
  generateAsync(options: { type: 'blob' }): Promise<Blob>;
}

export interface DownloadArtifactsAsZipParams {
  readonly baseUrl: string;
  readonly projectId: string;
  readonly bucket: string;
  /** Already-expanded flat file list (old app's folder→file expansion against `bucketContents`, utils.jsx:455-471, is a selection/UI concern left to the caller). */
  readonly filenames: readonly string[];
  readonly archiver: ZipArchiver;
  /** Stripped from each entry's path inside the archive (utils.jsx:517-523). */
  readonly currentPrefix?: string;
  readonly devToken?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (current: number, total: number, filename: string) => void;
}

export type DownloadArtifactsAsZipResult =
  | { readonly status: 'ok'; readonly blob: Blob }
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly error: HttpFailure; readonly filename: string };

function stripCurrentPrefix(filename: string, currentPrefix?: string): string {
  if (currentPrefix === undefined || currentPrefix === '') return filename;
  const normalized = currentPrefix.endsWith('/') ? currentPrefix : `${currentPrefix}/`;
  return filename.startsWith(normalized) ? filename.slice(normalized.length) : filename;
}

/**
 * Sequential per-file fetch + ZIP assembly (old: utils.jsx:444-543
 * `downloadArtifactsAsZip`). Stops and reports `cancelled` on an empty file
 * list or an aborted signal (parity: utils.jsx:487-491's `onCancel` path);
 * stops and reports the failing file on the first HTTP/network error
 * (parity: the old code's per-file `throw`, which the caller's `.catch`
 * surfaced — here it is a Result, never a throw, per §3.6).
 */
export async function downloadArtifactsAsZip(params: DownloadArtifactsAsZipParams): Promise<DownloadArtifactsAsZipResult> {
  const { filenames } = params;
  if (filenames.length === 0) return { status: 'cancelled' };

  for (let index = 0; index < filenames.length; index++) {
    if (params.signal?.aborted === true) return { status: 'cancelled' };
    const filename = filenames[index];
    if (filename === undefined) continue;

    const result = await fetchArtifactBlob({
      baseUrl: params.baseUrl,
      projectId: params.projectId,
      bucket: params.bucket,
      filePath: filename,
      devToken: params.devToken,
      signal: params.signal,
    });
    if (!result.ok) {
      if (result.error.kind === 'aborted') return { status: 'cancelled' };
      return { status: 'error', error: result.error, filename };
    }

    params.archiver.file(stripCurrentPrefix(filename, params.currentPrefix), result.data);
    params.onProgress?.(index + 1, filenames.length, filename);
  }

  const blob = await params.archiver.generateAsync({ type: 'blob' });
  return { status: 'ok', blob };
}
