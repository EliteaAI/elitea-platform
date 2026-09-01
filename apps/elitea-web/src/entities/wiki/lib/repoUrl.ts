/**
 * Parsing a repository reference into a repository and a branch.
 *
 * PORTED BUG-FOR-BUG from apps/deepwiki-ui/src/DeepWikiApp.jsx:163-470. Every
 * rule here decides which wikis a project can see, so a "tidier" rule is a
 * project whose wikis disappear or whose neighbour's appear. Where the legacy
 * logic looks arbitrary it is preserved and the reason is written down.
 */
import type { RepositoryIdentity } from '../model/types';


/**
 * The repository path inside an http(s) URL, or null if it will not parse.
 *
 * Extracted from parseRepositoryIdentity only to keep that function under the
 * complexity limit; the body is unchanged.
 *
 * THE `/_git/` BRANCH IS AZURE DEVOPS. A URL like
 * `https://org.visualstudio.com/project/_git/repo` carries the organisation in
 * the HOSTNAME rather than the path, so it is lifted out and prepended.
 * Without that, two organisations' identically named projects normalise to one
 * wiki_id prefix and each would see the other's wikis.
 */
function repoPathFromUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  const path = url.pathname.replace(/^\/+|\/+$/g, '');
  if (!path.includes('/_git/')) return path;

  const [projectPath, repoName] = path.split('/_git/');
  if (hostname.endsWith('.visualstudio.com')) {
    const organization = hostname.split('.')[0];
    return [organization, projectPath, repoName].filter(Boolean).join('/');
  }
  return `${projectPath}/${repoName}`;
}


/**
 * An identity carried by an object rather than a string.
 *
 * Extracted from parseRepositoryIdentity to keep it under the complexity
 * limit; the alias lists and their order are unchanged. The repository is
 * resolved by recursing, so an object whose `repository` is itself a URL is
 * parsed the same way a bare URL would be.
 */
function identityFromObject(value: Record<string, unknown>): RepositoryIdentity {
  const nested = parseRepositoryIdentity(
    value.repository ||
      value.repo ||
      value.canonical_repo_identifier ||
      value.repo_identifier ||
      value.identifier,
  );
  const branch = ['branch', 'active_branch', 'base_branch']
    .map((name) => value[name])
    .find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate));
  return {
    repository: nested.repository,
    branch: branch ?? nested.branch ?? null,
  };
}

/**
 * Split a repository reference into a path and a branch.
 *
 * Accepts an object (recursing through its own aliases), an https URL, an
 * scp-style git@ address, or `path:branch`.
 *
 * THE `_git` BRANCH IS AZURE DEVOPS. A URL like
 * `https://org.visualstudio.com/project/_git/repo` has the organisation in the
 * HOSTNAME, not the path, so it is lifted out and prepended — otherwise two
 * different organisations' identically named projects normalise to one prefix
 * and each would see the other's wikis.
 */
export function parseRepositoryIdentity(value: unknown): RepositoryIdentity {
  if (!value) return { repository: null, branch: null };

  if (typeof value === 'object') {
    return identityFromObject(value as Record<string, unknown>);
  }

  if (typeof value !== 'string') return { repository: null, branch: null };

  const repoPath0 = value.trim();

  if (!repoPath0) return { repository: null, branch: null };

  const split = splitPathAndBranch(repoPath0);
  if (split === null) return { repository: null, branch: null };

  const repoPath = split.path.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');

  return { repository: repoPath || null, branch: split.branch };
}

/**
 * Separate a reference's path from an inline branch.
 *
 * The three forms, and only the third carries a branch:
 *
 *   https://host/owner/repo   the path, via repoPathFromUrl
 *   git@host:owner/repo       everything after the FIRST colon, rejoined —
 *                             an scp-style address whose path itself contains
 *                             a colon must survive
 *   owner/repo:branch         split on the first colon
 *
 * null means the reference will not parse at all.
 */
function splitPathAndBranch(value: string): { path: string; branch: string | null } | null {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    const fromUrl = repoPathFromUrl(value);
    return fromUrl === null ? null : { path: fromUrl, branch: null };
  }
  if (value.startsWith('git@') && value.includes(':')) {
    return { path: value.split(':').slice(1).join(':'), branch: null };
  }
  if (value.includes(':')) {
    const parts = value.split(':');
    // `?? ''` only satisfies noUncheckedIndexedAccess: String.split never
    // returns an empty array, so parts[0] is always present.
    return { path: parts[0] ?? '', branch: parts[1] || null };
  }
  return { path: value, branch: null };
}

/**
 * The Azure DevOps organisation, from a `dev.azure.com` path or a
 * `*.visualstudio.com` hostname. Anything else is null.
 */
export function extractAdoOrganization(adoConfig: unknown): string | null {
  const cfg = (adoConfig ?? {}) as Record<string, unknown>;
  const organizationUrl = cfg.organization_url || cfg.url;
  if (!organizationUrl || typeof organizationUrl !== 'string') return null;

  try {
    const parsedUrl = new URL(organizationUrl);
    if (parsedUrl.hostname === 'dev.azure.com') {
      return parsedUrl.pathname.split('/').filter(Boolean)[0] || null;
    }
    if (parsedUrl.hostname.endsWith('.visualstudio.com')) {
      return parsedUrl.hostname.split('.')[0] || null;
    }
  } catch {
    return null;
  }

  return null;
}
