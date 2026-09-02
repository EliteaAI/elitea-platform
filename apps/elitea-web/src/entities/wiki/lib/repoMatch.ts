/**
 * Deciding whether a stored wiki belongs to a configured repository.
 *
 * PORTED BUG-FOR-BUG from apps/deepwiki-ui/src/DeepWikiApp.jsx:163-470. Every
 * rule here decides which wikis a project can see, so a "tidier" rule is a
 * project whose wikis disappear or whose neighbour's appear. Where the legacy
 * logic looks arbitrary it is preserved and the reason is written down.
 */
import type { RepositoryMatchInfo, WikiManifest } from '../model/types';
import { parseRepositoryIdentity } from './repoUrl';
import { normalizeWikiIdPart } from './wikiId';

/** Everything the matching rules need about one identity, computed once. */
function getRepositoryMatchInfo(repoIdentity: unknown): RepositoryMatchInfo {
  const parsed = parseRepositoryIdentity(repoIdentity);
  if (!parsed.repository) {
    return {
      parsed,
      prefix: null,
      repositoryLeaf: null,
      branchPart: null,
      leafBranchSuffix: null,
      hasBranch: false,
    };
  }

  const parts = parsed.repository
    .split('/')
    .filter(Boolean)
    .map(normalizeWikiIdPart)
    .filter((p): p is string => Boolean(p));
  const branchPart = normalizeWikiIdPart(parsed.branch);
  const repositoryLeaf = parts.length > 0 ? (parts[parts.length - 1] ?? null) : null;

  return {
    parsed,
    prefix:
      parts.length > 0
        ? branchPart
          ? [...parts, branchPart].join('--')
          : parts.join('--')
        : null,
    repositoryLeaf,
    branchPart,
    leafBranchSuffix: repositoryLeaf && branchPart ? `${repositoryLeaf}--${branchPart}` : null,
    hasBranch: Boolean(parsed.branch),
  };
}

/** The wiki_id prefix an identity normalises to. */
export function normalizeRepoToWikiIdPrefix(repoIdentity: unknown): string | null {
  return getRepositoryMatchInfo(repoIdentity).prefix;
}

/**
 * Does a manifest belong to this repository?
 *
 * THE BRANCH RULE IS ASYMMETRIC AND DELIBERATE. When the configured identity
 * names no branch, a manifest whose prefix merely STARTS with the repository
 * prefix matches — so an unbranched configuration sees every branch's wiki.
 * When a branch IS named, only an exact prefix match counts. Relaxing the
 * second would show a project the wrong branch's wiki, which reads as correct.
 */
export function manifestMatchesRepo(
  manifest: WikiManifest | null | undefined,
  configuredRepoIdentity: unknown,
): boolean {
  if (!manifest || !configuredRepoIdentity) return false;

  const expectedInfo = getRepositoryMatchInfo(configuredRepoIdentity);
  const expectedPrefix = expectedInfo.prefix;
  const matchesPrefix = (prefix: string | null): boolean => {
    if (!prefix) return false;
    const normalizedPrefix = prefix.toLowerCase();
    if (normalizedPrefix === expectedPrefix) return true;
    return !expectedInfo.hasBranch && normalizedPrefix.startsWith(`${expectedPrefix}--`);
  };

  return [
    typeof manifest.wiki_id === 'string' ? manifest.wiki_id : null,
    normalizeRepoToWikiIdPrefix({ repository: manifest.repository, branch: manifest.branch }),
    normalizeRepoToWikiIdPrefix(manifest.canonical_repo_identifier),
  ].some(matchesPrefix);
}

function repositoryLeafAndBranchMatch(
  candidateRepoIdentity: unknown,
  expectedInfo: RepositoryMatchInfo,
): boolean {
  const candidateInfo = getRepositoryMatchInfo(candidateRepoIdentity);
  if (!candidateInfo.repositoryLeaf || !expectedInfo.repositoryLeaf) return false;
  if (candidateInfo.repositoryLeaf !== expectedInfo.repositoryLeaf) return false;
  if (expectedInfo.branchPart && candidateInfo.branchPart !== expectedInfo.branchPart) return false;
  return true;
}

function manifestRepoMatchKey(manifest: WikiManifest | null | undefined): string | null {
  const candidates: unknown[] = [
    manifest?.canonical_repo_identifier,
    { repository: manifest?.repository, branch: manifest?.branch },
  ];

  for (const candidate of candidates) {
    const info = getRepositoryMatchInfo(candidate);
    if (info.parsed.repository && info.branchPart) {
      return `${info.parsed.repository.toLowerCase()}:${info.branchPart}`;
    }
  }

  return null;
}

/**
 * The manifests belonging to a repository.
 *
 * THE SECOND PASS IS A NARROW RESCUE, not a general loosening. When the strict
 * prefix match finds nothing AND the configured repository is a bare name with
 * no owner (one path component) AND a branch is known, manifests are matched on
 * repository LEAF plus branch. That covers a toolkit configured as `repo`
 * against wikis stored as `owner--repo--branch`.
 *
 * It returns results only when every leaf match agrees on ONE canonical
 * repository. Two different owners with the same repository name and branch
 * produce two keys, and the function returns nothing rather than guessing —
 * which is the case where showing the wrong project's wiki would look right.
 */
export function filterManifestsByRepo(
  manifests: WikiManifest[],
  configuredRepoIdentity: unknown,
): WikiManifest[] {
  const strictMatches = manifests.filter((m) => manifestMatchesRepo(m, configuredRepoIdentity));
  if (strictMatches.length > 0) return strictMatches;

  const expectedInfo = getRepositoryMatchInfo(configuredRepoIdentity);
  const repoParts = expectedInfo.parsed.repository?.split('/').filter(Boolean) || [];
  if (repoParts.length !== 1 || !expectedInfo.leafBranchSuffix) return [];

  const leafMatches = manifests.filter((manifest) =>
    [
      { repository: manifest.repository, branch: manifest.branch },
      manifest.canonical_repo_identifier,
    ].some((candidate) => repositoryLeafAndBranchMatch(candidate, expectedInfo)),
  );

  const canonicalKeys = new Set(leafMatches.map(manifestRepoMatchKey).filter(Boolean));
  return canonicalKeys.size === 1 ? leafMatches : [];
}

/**
 * Does an artifact key belong to this repository?
 *
 * Keys are `{wiki_id}/...`, so only the first path segment is considered. The
 * same asymmetric branch rule as manifestMatchesRepo applies.
 */
export function artifactMatchesRepo(
  artifactName: string | null | undefined,
  configuredRepoIdentity: unknown,
): boolean {
  if (!artifactName || !configuredRepoIdentity) return false;

  const expectedInfo = getRepositoryMatchInfo(configuredRepoIdentity);
  const expectedPrefix = expectedInfo.prefix;
  const normalizedName = artifactName.toLowerCase();
  const artifactPrefix = normalizedName.split('/')[0] ?? '';

  if (expectedPrefix) {
    if (artifactPrefix === expectedPrefix || normalizedName.startsWith(`${expectedPrefix}/`)) {
      return true;
    }
    return !expectedInfo.hasBranch && artifactPrefix.startsWith(`${expectedPrefix}--`);
  }

  return false;
}
