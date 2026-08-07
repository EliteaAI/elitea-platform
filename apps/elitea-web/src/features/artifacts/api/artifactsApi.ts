import { normaliseArtifactList, type Artifact, type ArtifactListWire } from '@/entities/artifact';
import { isSystemBucket, normaliseBuckets, type Bucket, type BucketWire, sortBucketsPinnedFirst } from '@/entities/bucket';
import {
  batchDeleteObjects,
  createBucket,
  deleteBucket,
  deleteObject,
  updateBucket,
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
  return sortBucketsPinnedFirst(result.data.buckets
    .filter((bucket) => !isSystemBucket(bucket.name))
    .map((bucket) => ({
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

/**
 * MIGRATION NOTE (Phase 1c) — this module was written against the LEGACY
 * Pylon artifacts plugin (`legacy/plugins/artifacts`, routes
 * `/artifacts/buckets/default/{project}`, `/artifacts/artifact(s)/...`).
 * elitea-main serves a different, newer API (S11): `/api/v2/artifacts/
 * {buckets,objects,grants}`. The legacy operation names survived here only
 * because the checked-in orval client was stale and still exported them —
 * regenerating removed them and surfaced that these four calls had no
 * endpoint on either side. Mapping applied:
 *
 *   editBucket      (PUT, retention)  -> updateBucket  { retention_days }
 *   updateBucketPin (PATCH, is_pinned)-> updateBucket  { is_pinned }
 *   deleteArtifact                    -> deleteObject
 *   deleteArtifacts (URL-chunked)     -> batchDeleteObjects (body, one call)
 *
 * `projectId` is a numeric path segment in the new client, so it is parsed
 * once here rather than threaded as a string through every call site.
 */
function toProjectID(projectId: string): number {
  const parsed = Number(projectId);
  if (!Number.isInteger(parsed)) throw new Error(`Project id "${projectId}" is not numeric.`);
  return parsed;
}

export async function createArtifactBucket(projectId: string, name: string): Promise<void> {
  await createBucket(toProjectID(projectId), { name });
}

/**
 * Set a bucket's retention window. NOT a rename: the legacy `editBucket` PUT
 * configured the S3 lifecycle (`expiration_measure`/`expiration_value` ->
 * `configure_bucket_lifecycle`, `legacy/plugins/artifacts/api/v2/buckets.py:184`);
 * the new API models the same thing as `retention_days`. There is no rename
 * operation in either API — S3 buckets cannot be renamed in place.
 */
export async function setArtifactBucketRetention(
  projectId: string,
  name: string,
  retentionDays: number | null,
): Promise<void> {
  await updateBucket(toProjectID(projectId), name, { retention_days: retentionDays });
}

export async function setArtifactBucketPinned(projectId: string, name: string, isPinned: boolean): Promise<void> {
  await updateBucket(toProjectID(projectId), name, { is_pinned: isPinned });
}

export async function removeArtifactBucket(projectId: string, name: string): Promise<void> {
  await deleteBucket(toProjectID(projectId), name);
}

export async function removeArtifact(projectId: string, bucket: string, key: string): Promise<void> {
  await deleteObject(toProjectID(projectId), bucket, key);
}

/**
 * Legacy chunked deletion by URL length is gone: `batchDeleteObjects` takes
 * the keys in a request BODY, so there is no path-length ceiling to work
 * around. An empty array is a 400 on the server and never means "delete the
 * bucket", so it is skipped here instead of being sent.
 */
export async function removeArtifacts(projectId: string, bucket: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await batchDeleteObjects(toProjectID(projectId), bucket, { keys: [...keys] });
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
