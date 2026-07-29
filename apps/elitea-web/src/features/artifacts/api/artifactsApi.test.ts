import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createBucket,
  deleteArtifact,
  deleteArtifacts,
  deleteBucket,
  editBucket,
  updateBucketPin,
} from '@/shared/api/generated/artifacts/artifacts';
import { eliteaFetch } from '@/shared/api/generated/mutator';
import { listArtifacts, listBuckets } from '@/shared/api/artifacts';
import * as generatedArtifacts from '@/shared/api/generated/artifacts/artifacts';
import * as generatedMutator from '@/shared/api/generated/mutator';
import * as sharedArtifacts from '@/shared/api/artifacts';

import {
  chunkArtifactKeys,
  createArtifactBucket,
  fetchArtifacts,
  fetchArtifactBuckets,
  fetchArtifactStorageConfigurations,
  removeArtifact,
  removeArtifacts,
  removeArtifactBucket,
  renameArtifactBucket,
  setArtifactBucketPinned,
} from './artifactsApi';

const okResponse = { data: {}, status: 200, headers: new Headers() };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(generatedArtifacts, 'createBucket');
  vi.spyOn(generatedArtifacts, 'deleteArtifact');
  vi.spyOn(generatedArtifacts, 'deleteArtifacts');
  vi.spyOn(generatedArtifacts, 'deleteBucket');
  vi.spyOn(generatedArtifacts, 'editBucket');
  vi.spyOn(generatedArtifacts, 'updateBucketPin');
  vi.spyOn(generatedMutator, 'eliteaFetch');
  vi.spyOn(sharedArtifacts, 'listArtifacts');
  vi.spyOn(sharedArtifacts, 'listBuckets');
  vi.mocked(eliteaFetch).mockResolvedValue({ data: { rows: [] } });
});

describe('artifacts API', () => {
  it('merges S3 buckets with persisted pin metadata and sorts pinned first', async () => {
    vi.mocked(listBuckets).mockResolvedValue({
      ok: true,
      data: {
        buckets: [
          { name: 'zeta', creation_date: '2026-01-01T00:00:00Z' },
          { name: 'alpha', creation_date: '2026-01-02T00:00:00Z' },
        ],
      },
      status: 200,
      headers: new Headers(),
    });
    vi.mocked(eliteaFetch).mockResolvedValue({
      data: {
        rows: [
          { id: '1', name: 'alpha', is_pinned: true, created_at: '2026-02-01T00:00:00Z' },
        ],
      },
    });
    await expect(fetchArtifactBuckets('/api/v2', 'p1')).resolves.toEqual([
      { id: '1', name: 'alpha', isPinned: true, createdAt: '2026-02-01T00:00:00Z' },
      { id: 'zeta', name: 'zeta', isPinned: false, createdAt: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('rejects failed and malformed bucket responses', async () => {
    vi.mocked(listBuckets).mockResolvedValue({
      ok: false,
      error: { kind: 'http', status: 500, url: '/x', body: null },
    });
    await expect(fetchArtifactBuckets('/api/v2', 'p1')).rejects.toThrow('Unable');
    vi.mocked(listBuckets).mockResolvedValue({ ok: true, data: {}, status: 200, headers: new Headers() });
    await expect(fetchArtifactBuckets('/api/v2', 'p1')).rejects.toThrow('unexpected');
  });

  it('normalizes artifact listings and rejects malformed responses', async () => {
    vi.mocked(listArtifacts).mockResolvedValue({
      ok: true,
      data: {
        name: 'docs',
        contents: [{ key: 'a.txt', size: 2, lastModified: '2026-01-01T00:00:00Z' }],
      },
      status: 200,
      headers: new Headers(),
    });
    await expect(fetchArtifacts('/api/v2', 'p1', 'docs')).resolves.toEqual([
      { key: 'a.txt', size: 2, lastModified: '2026-01-01T00:00:00Z', bucket: 'docs' },
    ]);
    vi.mocked(listArtifacts).mockResolvedValue({ ok: true, data: { bad: true }, status: 200, headers: new Headers() });
    await expect(fetchArtifacts('/api/v2', 'p1', 'docs')).rejects.toThrow('unexpected');
  });

  it('delegates bucket and artifact mutations to generated endpoints', async () => {
    vi.mocked(createBucket).mockResolvedValue(okResponse as never);
    vi.mocked(editBucket).mockResolvedValue(okResponse as never);
    vi.mocked(updateBucketPin).mockResolvedValue(okResponse as never);
    vi.mocked(deleteBucket).mockResolvedValue(okResponse as never);
    vi.mocked(deleteArtifact).mockResolvedValue(okResponse as never);
    vi.mocked(deleteArtifacts).mockResolvedValue({ data: undefined, status: 204, headers: new Headers() });

    await createArtifactBucket('p1', 'docs');
    await renameArtifactBucket('p1', 'docs', 'reports');
    await setArtifactBucketPinned('p1', 'reports', true);
    await removeArtifactBucket('p1', 'reports');
    await removeArtifact('p1', 'docs', 'a.txt');
    await removeArtifacts('p1', 'docs', ['a.txt', 'b.txt']);

    expect(createBucket).toHaveBeenCalledWith('p1', { name: 'docs' });
    expect(editBucket).toHaveBeenCalledWith('p1', { name: 'reports' }, { name: 'docs' });
    expect(updateBucketPin).toHaveBeenCalledWith('p1', { is_pinned: true }, { name: 'reports' });
    expect(deleteBucket).toHaveBeenCalledWith('p1', { name: 'reports' });
    expect(deleteArtifact).toHaveBeenCalledWith('p1', 'docs', { filename: 'a.txt' });
    expect(deleteArtifacts).toHaveBeenCalledWith('p1', 'docs', { 'fname[]': ['a.txt', 'b.txt'] });
  });

  it('stops mutation helpers on a non-success status', async () => {
    vi.mocked(createBucket).mockResolvedValue({ data: {}, status: 400, headers: new Headers() } as never);
    await expect(createArtifactBucket('p1', 'bad')).rejects.toThrow('status 400');
  });

  it('chunks long bulk-delete URLs', () => {
    const chunks = chunkArtifactKeys('p1', 'docs', [
      `a-${'x'.repeat(900)}`,
      `b-${'y'.repeat(900)}`,
      'short',
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks.flat()).toHaveLength(3);
  });

  it('loads and normalizes regular and shared S3 configurations', async () => {
    vi.mocked(eliteaFetch).mockResolvedValue({
      data: {
        items: [{ id: 1, title: 'Primary' }],
        shared: { items: [{ uid: 'shared', elitea_title: 'Shared', shared: true }] },
      },
    });
    await expect(fetchArtifactStorageConfigurations('p1')).resolves.toEqual([
      { id: '1', title: 'Primary', shared: false },
      { id: 'shared', title: 'Shared', shared: true },
    ]);
    expect(vi.mocked(eliteaFetch).mock.calls[0]?.[0]).toContain('type=s3');
  });
});
