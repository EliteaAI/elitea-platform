import type { Artifact, ArtifactListWire } from '../model/types';

/**
 * `ListObjectsResponse` (objects.go:250) carries no bucket name at all — the
 * bucket is only in the request path — so the caller supplies it here and it
 * is flattened onto each entry, keeping `Artifact` self-contained.
 */
export function normaliseArtifactList(wire: ArtifactListWire, bucket: string): Artifact[] {
  return wire.objects.map((entry) => ({
    key: entry.key,
    size: entry.size_bytes,
    lastModified: entry.modified_at,
    bucket,
  }));
}
