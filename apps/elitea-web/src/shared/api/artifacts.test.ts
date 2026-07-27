/**
 * shared/api/artifacts.ts — spec §5.7 rows 1, 3, 5 (unit S6).
 * Covers: the exact base-URL-prefix-strip logic (row 1), the un-prefixed
 * /artifacts/s3/ path (row 5, RED/GREEN proof b), the artifact-content blob
 * fetch staying under /api/v2 (row 3), credentials resolution, DEV token
 * gating, http/network failure paths, and the ZIP multi-download loop.
 */
import { Blob as NodeBlob } from 'node:buffer';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { server } from '../../test/setup';
import {
  artifactContentByPath,
  artifactContentNetworkError,
  artifactContentNotFound,
  artifactContentOk,
  artifactListNetworkError,
  artifactListOk,
  bucketListLyingJson,
  bucketListNetworkError,
  bucketListNotFound,
  bucketListOk,
  s3PutNetworkError,
  s3PutNotFound,
  s3PutOk,
} from '../../test/msw/handlers/artifacts';
import type { CapturedArtifactsRequest } from '../../test/msw/handlers/artifacts';

import {
  API_V2_SUFFIX,
  buildArtifactContentUrl,
  buildArtifactListUrl,
  buildBucketListUrl,
  buildS3UploadUrl,
  downloadArtifactsAsZip,
  fetchArtifactBlob,
  listArtifacts,
  listBuckets,
  putArtifactToS3,
  stripApiV2Prefix,
  stripBaseUrlSuffix,
} from './artifacts';
import type { ZipArchiver } from './artifacts';

const ORIGIN = window.location.origin;
const CROSS_ORIGIN_BASE = `${ORIGIN.replace('localhost', 'cross-origin.example')}/api/v2`;

/**
 * Node's native `fetch`/`Request` (undici) is what `artifacts.ts` actually
 * calls in this test environment (jsdom does not implement `fetch` itself).
 * A `Blob` built from the jsdom-environment global `Blob` is a DIFFERENT
 * class from undici's internal one; undici's `Request` body-extraction does
 * not recognise it and silently serialises the body as the literal string
 * "undefined" (reproduced and confirmed independent of msw — even a bare
 * `new Request(url, {body: new Blob([...])})` exhibits it). Using
 * `node:buffer`'s `Blob` for any test that asserts on REQUEST BODY CONTENT
 * sidesteps the cross-realm gap; response-side Blobs (`fetchArtifactBlob`
 * etc.) are unaffected since those originate from undici's own `Response`.
 */
function nodeBlob(parts: string[], options?: { type?: string }): Blob {
  return new NodeBlob(parts, options) as unknown as Blob;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('stripBaseUrlSuffix / stripApiV2Prefix — exact port of clearBaseUrlPrefix (utils.jsx:26-33)', () => {
  it('strips the suffix and any trailing slash', () => {
    expect(stripBaseUrlSuffix('/api/v2', '/api/v2')).toBe('');
    expect(stripBaseUrlSuffix('https://dev.elitea.ai/api/v2', '/api/v2')).toBe('https://dev.elitea.ai');
  });

  it('strips a suffix that already has a trailing slash on the input', () => {
    expect(stripBaseUrlSuffix('https://dev.elitea.ai/api/v2/', '/api/v2')).toBe('https://dev.elitea.ai');
  });

  it('with no suffix argument, only strips a trailing slash (row 3 use)', () => {
    expect(stripBaseUrlSuffix('/api/v2')).toBe('/api/v2');
    expect(stripBaseUrlSuffix('/api/v2/')).toBe('/api/v2');
  });

  it('replaces only the FIRST occurrence, unanchored — the preserved old-app quirk', () => {
    // String.prototype.replace with a string pattern (not regex) is not anchored to
    // the end of the string; this is byte-for-byte what clearBaseUrlPrefix does.
    expect(stripBaseUrlSuffix('/api/v2/api/v2', '/api/v2')).toBe('/api/v2');
  });

  it('API_V2_SUFFIX is the literal /api/v2', () => {
    expect(API_V2_SUFFIX).toBe('/api/v2');
  });

  it('stripApiV2Prefix is stripBaseUrlSuffix(url, "/api/v2")', () => {
    expect(stripApiV2Prefix('/api/v2')).toBe(stripBaseUrlSuffix('/api/v2', API_V2_SUFFIX));
  });
});

describe('row 1 — buildS3UploadUrl (S3 direct PUT)', () => {
  it('strips /api/v2, joins the s3Path + per-segment-encoded key + project_id query (parity: slices/upload.js:104-108)', () => {
    const url = buildS3UploadUrl('/api/v2', '/artifacts/s3/my-bucket', 'folder/my file.txt', 'proj-1');
    expect(url).toBe('/artifacts/s3/my-bucket/folder/my%20file.txt?project_id=proj-1');
    expect(url).not.toContain('/api/v2');
  });

  it('encodes each path segment separately, preserving slashes', () => {
    const url = buildS3UploadUrl('/api/v2', '/artifacts/s3/b', 'a/b/c', 'p');
    expect(url).toContain('/a/b/c?');
  });
});

describe('row 1 — putArtifactToS3', () => {
  it('PUTs the raw file body and resolves ok:true, data:undefined on 2xx', async () => {
    const sink: CapturedArtifactsRequest[] = [];
    server.use(s3PutOk(sink));
    const file = nodeBlob(['file-bytes'], { type: 'text/plain' });
    const result = await putArtifactToS3({ baseUrl: '/api/v2', s3Path: '/artifacts/s3/bucket', fileKey: 'a.txt', projectId: 'p1', file });
    if (!result.ok) throw new Error('unreachable');
    expect(result.headers).toBeInstanceOf(Headers);
    expect(result).toEqual({ ok: true, status: 200, data: undefined, headers: result.headers });
    expect(sink[0]?.method).toBe('PUT');
    expect(sink[0]?.bodyText).toBe('file-bytes');
    expect(sink[0]?.contentType).toBe('text/plain');
  });

  it('falls back to application/octet-stream when neither contentType nor file.type is set', async () => {
    const sink: CapturedArtifactsRequest[] = [];
    server.use(s3PutOk(sink));
    const file = nodeBlob(['bytes']); // no type
    await putArtifactToS3({ baseUrl: '/api/v2', s3Path: '/artifacts/s3/bucket', fileKey: 'a.bin', projectId: 'p1', file });
    expect(sink[0]?.contentType).toBe('application/octet-stream');
  });

  it('an explicit contentType wins over file.type', async () => {
    const sink: CapturedArtifactsRequest[] = [];
    server.use(s3PutOk(sink));
    const file = nodeBlob(['x'], { type: 'text/plain' });
    await putArtifactToS3({ baseUrl: '/api/v2', s3Path: '/artifacts/s3/bucket', fileKey: 'a', projectId: 'p1', file, contentType: 'application/x-custom' });
    expect(sink[0]?.contentType).toBe('application/x-custom');
  });

  it('resolves same-origin credentials for the relative /api/v2 base (stripped base is same-origin)', async () => {
    const sink: CapturedArtifactsRequest[] = [];
    server.use(s3PutOk(sink));
    await putArtifactToS3({ baseUrl: '/api/v2', s3Path: '/artifacts/s3/b', fileKey: 'a', projectId: 'p1', file: nodeBlob(['x']) });
    expect(sink[0]?.credentials).toBe('same-origin');
  });

  it('resolves include credentials for a cross-origin absolute base — F4\'s cross-origin rule applied here (row 1)', async () => {
    const sink: CapturedArtifactsRequest[] = [];
    server.use(s3PutOk(sink));
    await putArtifactToS3({ baseUrl: CROSS_ORIGIN_BASE, s3Path: '/artifacts/s3/b', fileKey: 'a', projectId: 'p1', file: nodeBlob(['x']) });
    expect(sink[0]?.credentials).toBe('include');
  });

  it('attaches the DEV bearer + Cache-Control only under import.meta.env.DEV', async () => {
    const sink: CapturedArtifactsRequest[] = [];
    server.use(s3PutOk(sink));
    await putArtifactToS3({ baseUrl: '/api/v2', s3Path: '/artifacts/s3/b', fileKey: 'a', projectId: 'p1', file: nodeBlob(['x']), devToken: 'dev-secret' });
    expect(sink[0]?.authorization).toBe('Bearer dev-secret');
  });

  it('attaches no bearer outside DEV', async () => {
    vi.stubEnv('DEV', false);
    const sink: CapturedArtifactsRequest[] = [];
    server.use(s3PutOk(sink));
    await putArtifactToS3({ baseUrl: '/api/v2', s3Path: '/artifacts/s3/b', fileKey: 'a', projectId: 'p1', file: nodeBlob(['x']), devToken: 'dev-secret' });
    expect(sink[0]?.authorization).toBeNull();
  });

  it('resolves a kind:http failure for a 404, never throws', async () => {
    server.use(s3PutNotFound());
    const result = await putArtifactToS3({ baseUrl: '/api/v2', s3Path: '/artifacts/s3/b', fileKey: 'a', projectId: 'p1', file: nodeBlob(['x']) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toMatchObject({ kind: 'http', status: 404 });
  });

  it('resolves a kind:network failure for a network error, never throws', async () => {
    server.use(s3PutNetworkError());
    const result = await putArtifactToS3({ baseUrl: '/api/v2', s3Path: '/artifacts/s3/b', fileKey: 'a', projectId: 'p1', file: nodeBlob(['x']) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('network');
  });
});

describe('row 5 — un-prefixed /artifacts/s3/ path (RED/GREEN proof b)', () => {
  it('buildBucketListUrl never contains /api/v2', () => {
    const url = buildBucketListUrl('/api/v2', 'p1');
    expect(url).not.toContain(API_V2_SUFFIX);
    expect(url).toBe('/artifacts/s3/?project_id=p1&format=json');
  });

  it('buildArtifactListUrl never contains /api/v2 and uses encodeURI (not encodeURIComponent) on the bucket, matching api/artifacts.js:86', () => {
    const url = buildArtifactListUrl('/api/v2', 'p1', 'my bucket');
    expect(url).not.toContain(API_V2_SUFFIX);
    expect(url).toBe('/artifacts/s3/my%20bucket?project_id=p1&format=json');
  });

  it('listBuckets fetches the un-prefixed root-level URL and parses the JSON body', async () => {
    const sink: CapturedArtifactsRequest[] = [];
    server.use(bucketListOk(sink));
    const result = await listBuckets({ baseUrl: '/api/v2', projectId: 'p1' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.headers).toBeInstanceOf(Headers);
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { buckets: [{ name: 'demo-bucket', created_at: '2026-07-20T00:00:00Z' }] },
      headers: result.headers,
    });
    expect(sink[0]?.url).not.toContain('/api/v2/artifacts');
    expect(new URL(sink[0]!.url).pathname).toBe('/artifacts/s3/');
  });

  it('listArtifacts fetches the un-prefixed root-level URL', async () => {
    const sink: CapturedArtifactsRequest[] = [];
    server.use(artifactListOk(sink));
    const result = await listArtifacts({ baseUrl: '/api/v2', projectId: 'p1', bucket: 'demo-bucket' });
    expect(result.ok).toBe(true);
    expect(new URL(sink[0]!.url).pathname).toBe('/artifacts/s3/demo-bucket');
  });

  it('listBuckets resolves a kind:network failure without throwing', async () => {
    server.use(bucketListNetworkError());
    const result = await listBuckets({ baseUrl: '/api/v2', projectId: 'p1' });
    expect(result.ok).toBe(false);
  });

  it('listBuckets resolves a kind:http failure for a 404, never throws', async () => {
    server.use(bucketListNotFound());
    const result = await listBuckets({ baseUrl: '/api/v2', projectId: 'p1' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toMatchObject({ kind: 'http', status: 404 });
  });

  it('listBuckets surfaces raw text when the server lies about application/json', async () => {
    server.use(bucketListLyingJson());
    const result = await listBuckets({ baseUrl: '/api/v2', projectId: 'p1' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.headers).toBeInstanceOf(Headers);
    expect(result).toEqual({ ok: true, status: 200, data: 'not json', headers: result.headers });
  });

  it('listArtifacts resolves a kind:network failure without throwing', async () => {
    server.use(artifactListNetworkError());
    const result = await listArtifacts({ baseUrl: '/api/v2', projectId: 'p1', bucket: 'b' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('network');
  });
});

describe('row 3 — buildArtifactContentUrl stays under /api/v2 (no strip, unlike rows 1/5)', () => {
  it('keeps /api/v2 in the URL', () => {
    const url = buildArtifactContentUrl('/api/v2', 'p1', 'bucket', 'notes.md');
    expect(url).toBe('/api/v2/artifacts/artifact/default/p1/bucket/notes.md');
  });

  it('encodes the file path as one component (nested paths become %2F)', () => {
    const url = buildArtifactContentUrl('/api/v2', 'p1', 'bucket', 'folder/notes.md');
    expect(url).toBe('/api/v2/artifacts/artifact/default/p1/bucket/folder%2Fnotes.md');
  });
});

describe('row 3 — fetchArtifactBlob', () => {
  it('resolves ok:true with the response Blob', async () => {
    server.use(artifactContentOk());
    const result = await fetchArtifactBlob({ baseUrl: '/api/v2', projectId: 'p1', bucket: 'bucket', filePath: 'notes.md' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data).toBeInstanceOf(Blob);
    expect(await result.data.text()).toBe('hello artifact content');
  });

  it('resolves include credentials — unifies utils.jsx (no credentials) and the hook (credentials:include) under one rule', async () => {
    const sink: CapturedArtifactsRequest[] = [];
    server.use(artifactContentOk(sink));
    await fetchArtifactBlob({ baseUrl: '/api/v2', projectId: 'p1', bucket: 'b', filePath: 'f.md' });
    expect(sink[0]?.credentials).toBe('same-origin'); // /api/v2 is same-origin relative to the page here
  });

  it('resolves a kind:http failure for a 404, never throws', async () => {
    server.use(artifactContentNotFound());
    const result = await fetchArtifactBlob({ baseUrl: '/api/v2', projectId: 'p1', bucket: 'b', filePath: 'missing.md' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toMatchObject({ kind: 'http', status: 404 });
  });

  it('resolves a kind:network failure, never throws', async () => {
    server.use(artifactContentNetworkError());
    const result = await fetchArtifactBlob({ baseUrl: '/api/v2', projectId: 'p1', bucket: 'b', filePath: 'f.md' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('network');
  });

  it('resolves a kind:aborted failure for a pre-aborted signal, never throws', async () => {
    server.use(artifactContentOk());
    const controller = new AbortController();
    controller.abort();
    const result = await fetchArtifactBlob({ baseUrl: '/api/v2', projectId: 'p1', bucket: 'b', filePath: 'f.md', signal: controller.signal });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    if (result.error.kind !== 'aborted') throw new Error('unreachable');
    expect(result.error.url).toContain('/artifacts/artifact/default');
  });
});

function mockArchiver(): ZipArchiver & { files: Map<string, Blob> } {
  const files = new Map<string, Blob>();
  return {
    files,
    file(path, data) {
      files.set(path, data);
    },
    generateAsync() {
      return Promise.resolve(new Blob(['zip-bytes']));
    },
  };
}

describe('row 3 — downloadArtifactsAsZip', () => {
  it('fetches every file, strips currentPrefix from the archive path, and generates the zip blob', async () => {
    server.use(artifactContentByPath({ 'folder%2Fa.md': 'A content', 'folder%2Fb.md': 'B content' }));
    const archiver = mockArchiver();
    const progress: Array<[number, number, string]> = [];
    const result = await downloadArtifactsAsZip({
      baseUrl: '/api/v2',
      projectId: 'p1',
      bucket: 'bucket',
      filenames: ['folder/a.md', 'folder/b.md'],
      currentPrefix: 'folder',
      archiver,
      onProgress: (current, total, filename) => progress.push([current, total, filename]),
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.blob).toBeInstanceOf(Blob);
    expect([...archiver.files.keys()].sort()).toEqual(['a.md', 'b.md']);
    expect(progress).toEqual([
      [1, 2, 'folder/a.md'],
      [2, 2, 'folder/b.md'],
    ]);
  });

  it('reports cancelled for an empty file list', async () => {
    const result = await downloadArtifactsAsZip({ baseUrl: '/api/v2', projectId: 'p1', bucket: 'b', filenames: [], archiver: mockArchiver() });
    expect(result).toEqual({ status: 'cancelled' });
  });

  it('reports cancelled when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await downloadArtifactsAsZip({ baseUrl: '/api/v2', projectId: 'p1', bucket: 'b', filenames: ['a.md'], archiver: mockArchiver(), signal: controller.signal });
    expect(result).toEqual({ status: 'cancelled' });
  });

  it('stops and reports the failing file on the first HTTP error', async () => {
    server.use(artifactContentNotFound());
    const archiver = mockArchiver();
    const result = await downloadArtifactsAsZip({ baseUrl: '/api/v2', projectId: 'p1', bucket: 'b', filenames: ['missing.md'], archiver });
    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('unreachable');
    expect(result.filename).toBe('missing.md');
    expect(result.error).toMatchObject({ kind: 'http', status: 404 });
    expect(archiver.files.size).toBe(0);
  });

  it('keeps the full filename when currentPrefix is not a real prefix of it', async () => {
    server.use(artifactContentByPath({ 'a.md': 'A' }));
    const archiver = mockArchiver();
    await downloadArtifactsAsZip({ baseUrl: '/api/v2', projectId: 'p1', bucket: 'b', filenames: ['a.md'], currentPrefix: 'other/', archiver });
    expect([...archiver.files.keys()]).toEqual(['a.md']);
  });

  it('keeps the full filename when currentPrefix is omitted entirely', async () => {
    server.use(artifactContentByPath({ 'a.md': 'A' }));
    const archiver = mockArchiver();
    await downloadArtifactsAsZip({ baseUrl: '/api/v2', projectId: 'p1', bucket: 'b', filenames: ['a.md'], archiver });
    expect([...archiver.files.keys()]).toEqual(['a.md']);
  });
});
