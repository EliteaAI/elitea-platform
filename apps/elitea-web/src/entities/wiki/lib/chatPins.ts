import type { WikiManifest } from '../model/types';

/** What the wiki chat pins its retrieval to: the open wiki's own identifiers. */
export interface WikiChatPins {
  readonly repoIdentifierOverride?: string;
  readonly analysisKeyOverride?: string;
}

/**
 * The cache pins for a chat over ONE wiki, from its manifest.
 *
 * The provider's `repo_identifier_override` is "a canonical repo identifier
 * (owner/repo:branch:commit8) to pin caches" and `analysis_key_override`
 * "owner/repo:branch:commit8@wiki_version_id" — both are the manifest's own
 * fields. The engine takes an override AS IT IS, registered or not, so a bare
 * repository name there is not "the repository" but a cache key that exists
 * nowhere: every question answered `No wiki index found` while the wiki sat
 * generated beside it. MEASURED on the first real-engine chat through the
 * product (DWIKI-014b); the fixture runner never read the field.
 *
 * A manifest whose canonical identifier names no branch (the fixture's does
 * not) pins nothing, and the engine resolves `repository:branch` itself.
 */
export function chatPinsFor(manifest: WikiManifest | undefined): WikiChatPins {
  const canonical = manifest?.canonical_repo_identifier?.trim() ?? '';
  if (!/^[^:\s]+:[^:\s]+(?::[^:\s]+)?$/.test(canonical)) return {};
  const analysisKey = manifest?.analysis_key?.trim() ?? '';
  return {
    repoIdentifierOverride: canonical,
    ...(analysisKey.startsWith(`${canonical}@`) ? { analysisKeyOverride: analysisKey } : {}),
  };
}
