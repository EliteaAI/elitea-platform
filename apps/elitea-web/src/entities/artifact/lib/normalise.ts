import type { Artifact, ArtifactListWire } from '../model/types';

/**
 * `S3ObjectListResponse` (v2.yaml:1679-1700) carries the bucket name at the
 * RESPONSE-envelope level (`.name`), not per-item — this flattens it onto
 * each entry so `Artifact` is self-contained.
 */
export function normaliseArtifactList(wire: ArtifactListWire): Artifact[] {
  return wire.contents.map((entry) => ({
    key: entry.key,
    size: entry.size,
    lastModified: entry.lastModified,
    bucket: wire.name,
  }));
}
