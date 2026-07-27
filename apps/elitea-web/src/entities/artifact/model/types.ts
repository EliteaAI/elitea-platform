/**
 * Artifact domain type — a file stored in a bucket. Mirrors OpenAPI schema
 * `S3ObjectListResponse` (services/elitea-main/api/openapi/v2.yaml:
 * 1679-1700, unit W2 — the `?format=json` branch of `S3Handler.ListObjects`,
 * internal/api/v2/artifacts/s3handler.go:76-82) plus the upload/delete
 * response envelopes `ArtifactUploadResponse`/`ArtifactDeletedResponse`
 * (v2.yaml:1772-1798).
 *
 * There is no dedicated `Artifact` schema — an artifact IS an S3 object
 * `{key, size, lastModified}`; `bucket` is carried at the RESPONSE-envelope
 * level (`S3ObjectListResponse.name`), not per-item, and is attached here by
 * `lib/normalise.ts`.
 */
export interface Artifact {
  readonly key: string;
  readonly size: number;
  /** ISO 8601 date-time; camelCase on the wire (s3handler.go:71). */
  readonly lastModified: string;
  readonly bucket: string;
}

/** Wire shape of one `S3ObjectListResponse.contents[]` entry, pre-normalisation. */
export interface ArtifactWireEntry {
  readonly key: string;
  readonly size: number;
  readonly lastModified: string;
}

/** `S3ObjectListResponse` (v2.yaml:1679-1700) — the un-normalised response envelope. */
export interface ArtifactListWire {
  readonly contents: readonly ArtifactWireEntry[];
  /** The bucket name. */
  readonly name: string;
}

/** `ArtifactUploadResponse` (v2.yaml:1772-1783). */
export interface ArtifactUploadResult {
  readonly message: 'Done';
  readonly size: number;
  readonly name: string;
}

/** `ArtifactDeletedResponse` (v2.yaml:1785-1798). `size` is 0 when stat failed. */
export interface ArtifactDeleteResult {
  readonly message: 'Deleted';
  readonly size: number;
}
