/**
 * Reading wikis out of a project's artifact bucket.
 *
 * THE ROUTES ARE THE MODERN ONES, and that is not a preference. The vendored
 * bundle and the provider both speak
 * /api/v2/artifacts/artifact(s)/default/{projectId}/{bucket}[/{name}], which
 * elitea-main serves NO route in — proven six ways in
 * parity/notes/deepwiki-artifact-store.md and filed as a shipped defect. Those
 * paths 404 on the standalone Go stack and work only behind pylon. Porting them
 * would port a defect, so DWIKI-004 records them as waived and this file uses
 * /api/v2/artifacts/objects/... instead.
 *
 * eliteaFetch RETURNS THE ENVELOPE, not the body. The generated client's
 * mutator resolves to the whole `{ data, ... }` response shape, and typing a
 * call as the body gives an object whose fields are all undefined on a
 * successful 200 — the #132 defect, which happened twice on one endpoint.
 * Every reader here goes through `unwrapData`.
 */
import { eliteaFetch } from '@/shared/api/generated/mutator';

import type { WikiManifest, WikiObject } from '../model/types';

/** The bucket wikis are stored in. Fixed by the provider at invoke time. */
// Not exported: nothing outside this module names the bucket yet. The
// settings feature (DWIKI-010) is what makes it configurable.
const WIKI_BUCKET = 'wiki-artifacts';

/** A wiki manifest object key, e.g. `acme--repo--main/wiki_manifest_2026….json`. */
const MANIFEST_KEY = /(^|\/)wiki_manifest[^/]*\.json$/;

interface ObjectListEnvelope {
  data?: { objects?: WikiObject[]; common_prefixes?: string[] };
  objects?: WikiObject[];
  common_prefixes?: string[];
}

/**
 * Unwrap the eliteaFetch envelope.
 *
 * Accepts both shapes because the envelope is applied by the transport and a
 * raw body is what the MSW fixtures serve. Returning `undefined` for neither is
 * deliberate — a caller that gets an empty list must be able to tell it from a
 * shape it did not understand.
 */
function unwrapData<T>(response: unknown, pick: (v: Record<string, unknown>) => T | undefined): T | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const envelope = response as Record<string, unknown>;
  const inner = envelope.data;
  if (inner && typeof inner === 'object') {
    const fromInner = pick(inner as Record<string, unknown>);
    if (fromInner !== undefined) return fromInner;
  }
  return pick(envelope);
}

// NO /api/v2 PREFIX. eliteaFetch prepends the configured client baseUrl, which
// IS /api/v2 — writing it here too produces /api/v2/api/v2/... and a 404 that
// looks like an empty bucket. Every other entity API in this codebase passes a
// path relative to the base for the same reason.
function objectsPath(projectId: string | number, bucket: string): string {
  return `/artifacts/objects/${encodeURIComponent(String(projectId))}/${encodeURIComponent(bucket)}`;
}

function objectPath(projectId: string | number, bucket: string, key: string): string {
  // The key is a PATH with slashes (`wiki_id/wiki_pages/section/page.md`), so
  // each segment is encoded separately: encodeURIComponent on the whole key
  // would turn its slashes into %2F and address an object that does not exist.
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `${objectsPath(projectId, bucket)}/${encodedKey}`;
}

/** Every object in the project's wiki bucket. */
export async function listWikiObjects(
  projectId: string | number,
  bucket: string = WIKI_BUCKET,
): Promise<WikiObject[]> {
  const response = await eliteaFetch<ObjectListEnvelope>(objectsPath(projectId, bucket));
  return unwrapData(response, (v) => v.objects as WikiObject[] | undefined) ?? [];
}

/** The object keys that are wiki manifests. */
export function manifestKeys(objects: WikiObject[]): string[] {
  return objects.filter((o) => MANIFEST_KEY.test(o.key)).map((o) => o.key);
}

/** One wiki manifest. */
export async function fetchWikiManifest(
  projectId: string | number,
  key: string,
  bucket: string = WIKI_BUCKET,
): Promise<WikiManifest | undefined> {
  const response = await eliteaFetch<unknown>(objectPath(projectId, bucket, key));
  return unwrapData(response, (v) => (typeof v.wiki_id === 'string' ? (v as WikiManifest) : undefined));
}
