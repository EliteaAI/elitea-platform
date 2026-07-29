import { normaliseArtifactList, type Artifact, type ArtifactListWire } from '@/entities/artifact';
import { normaliseBuckets, type Bucket, type BucketWire, sortBucketsPinnedFirst } from '@/entities/bucket';
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

import type { ArtifactStorageConfiguration } from '../model/types';

interface S3BucketWire {
  readonly name: string;
  readonly creation_date: string;
}

interface S3BucketListWire {
  readonly buckets: readonly S3BucketWire[];
}

interface BucketMetadataPageWire {
  readonly rows: readonly BucketWire[];
}

interface ConfigurationWire {
  readonly id?: string | number;
  readonly uid?: string;
  readonly title?: string;
  readonly elitea_title?: string;
  readonly name?: string;
  readonly shared?: boolean;
}

interface ConfigurationPageWire {
  readonly items?: readonly ConfigurationWire[];
  readonly shared?: { readonly items?: readonly ConfigurationWire[] };
}

function expectSuccess<T extends { readonly status: number }>(response: T): T {
  if (response.status >= 400) throw new Error(`Artifact request failed with status ${response.status}.`);
  return response;
}

function isBucketListWire(value: unknown): value is S3BucketListWire {
  if (typeof value !== 'object' || value === null) return false;
  const buckets = (value as { buckets?: unknown }).buckets;
  return Array.isArray(buckets) && buckets.every((bucket) =>
    typeof bucket === 'object' &&
    bucket !== null &&
    typeof (bucket as { name?: unknown }).name === 'string' &&
    typeof (bucket as { creation_date?: unknown }).creation_date === 'string',
  );
}

function isArtifactListWire(value: unknown): value is ArtifactListWire {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { name?: unknown; contents?: unknown };
  return typeof candidate.name === 'string' && Array.isArray(candidate.contents) && candidate.contents.every((entry) =>
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { key?: unknown }).key === 'string' &&
    typeof (entry as { size?: unknown }).size === 'number' &&
    typeof (entry as { lastModified?: unknown }).lastModified === 'string',
  );
}

export async function fetchArtifactBuckets(baseUrl: string, projectId: string, signal?: AbortSignal): Promise<Bucket[]> {
  const [result, metadataEnvelope] = await Promise.all([
    listBuckets({ baseUrl, projectId, ...(signal ? { signal } : {}) }),
    eliteaFetch<{ data: BucketMetadataPageWire }>(
      `/artifacts/buckets/default/${encodeURIComponent(projectId)}`,
      signal ? { signal } : undefined,
    ),
  ]);
  if (!result.ok) throw new Error('Unable to load buckets.');
  if (!isBucketListWire(result.data)) throw new Error('The bucket response has an unexpected shape.');
  const metadata = new Map(normaliseBuckets(metadataEnvelope.data.rows).map((bucket) => [bucket.name, bucket]));
  return sortBucketsPinnedFirst(result.data.buckets.map((bucket) => ({
    id: metadata.get(bucket.name)?.id ?? bucket.name,
    name: bucket.name,
    isPinned: metadata.get(bucket.name)?.isPinned ?? false,
    createdAt: metadata.get(bucket.name)?.createdAt ?? bucket.creation_date,
  })));
}

export async function fetchArtifacts(
  baseUrl: string,
  projectId: string,
  bucket: string,
  signal?: AbortSignal,
): Promise<Artifact[]> {
  const result = await listArtifacts({ baseUrl, projectId, bucket, ...(signal ? { signal } : {}) });
  if (!result.ok) throw new Error('Unable to load artifacts.');
  if (!isArtifactListWire(result.data)) throw new Error('The artifact response has an unexpected shape.');
  return normaliseArtifactList(result.data);
}

export async function createArtifactBucket(projectId: string, name: string): Promise<void> {
  expectSuccess(await createBucket(projectId, { name }));
}

export async function renameArtifactBucket(projectId: string, currentName: string, nextName: string): Promise<void> {
  expectSuccess(await editBucket(projectId, { name: nextName }, { name: currentName }));
}

export async function setArtifactBucketPinned(projectId: string, name: string, isPinned: boolean): Promise<void> {
  expectSuccess(await updateBucketPin(projectId, { is_pinned: isPinned }, { name }));
}

export async function removeArtifactBucket(projectId: string, name: string): Promise<void> {
  expectSuccess(await deleteBucket(projectId, { name }));
}

export async function removeArtifact(projectId: string, bucket: string, key: string): Promise<void> {
  expectSuccess(await deleteArtifact(projectId, bucket, { filename: key }));
}

const DELETE_ARTIFACTS_MAX_PATH_LENGTH = 1500;

export function chunkArtifactKeys(projectId: string, bucket: string, keys: readonly string[]): string[][] {
  const baseLength = `/artifacts/artifacts/default/${projectId}/${encodeURI(bucket)}?`.length;
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = baseLength;
  for (const key of keys) {
    const parameterLength = `fname[]=${encodeURIComponent(key)}&`.length;
    if (current.length > 0 && length + parameterLength > DELETE_ARTIFACTS_MAX_PATH_LENGTH) {
      chunks.push(current);
      current = [];
      length = baseLength;
    }
    current.push(key);
    length += parameterLength;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function removeArtifacts(projectId: string, bucket: string, keys: readonly string[]): Promise<void> {
  for (const chunk of chunkArtifactKeys(projectId, bucket, keys)) {
    expectSuccess(await deleteArtifacts(projectId, bucket, { 'fname[]': chunk }));
  }
}

function configurationTitle(configuration: ConfigurationWire): string {
  return configuration.title ?? configuration.elitea_title ?? configuration.name ?? 'S3 storage';
}

export async function fetchArtifactStorageConfigurations(
  projectId: string,
  signal?: AbortSignal,
): Promise<ArtifactStorageConfiguration[]> {
  const query = new URLSearchParams({
    include_shared: 'true',
    shared_offset: '0',
    shared_limit: '100',
    limit: '100',
    offset: '0',
    type: 's3',
  });
  const envelope = await eliteaFetch<{ data: ConfigurationPageWire }>(
    `/configurations/configurations/${encodeURIComponent(projectId)}?${query.toString()}`,
    signal ? { signal } : undefined,
  );
  const page = envelope.data;
  const regular = page.items ?? [];
  const shared = page.shared?.items ?? [];
  return [...regular, ...shared].map((configuration, index) => ({
    id: String(configuration.id ?? configuration.uid ?? `${configurationTitle(configuration)}-${index}`),
    title: configurationTitle(configuration),
    shared: configuration.shared ?? index >= regular.length,
  }));
}
