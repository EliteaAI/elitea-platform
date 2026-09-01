/**
 * The wiki domain's shapes.
 *
 * `RepositoryIdentity` is the one that carries weight: a repository and the
 * branch it was analysed at. The legacy code passed these two around as a
 * string that sometimes carried the branch after a colon and sometimes did
 * not, which is why `parseRepositoryIdentity` exists and why everything
 * downstream takes the parsed pair.
 */

/** A repository and the branch a wiki was generated from. Either may be null. */
export interface RepositoryIdentity {
  repository: string | null;
  branch: string | null;
}

/**
 * Everything the matching rules need about one identity, computed once.
 *
 * `prefix` is the wiki_id form: path components and branch joined by `--`,
 * each part lower-cased with non-alphanumerics collapsed to hyphens. A wiki_id
 * is `owner--repo--branch` for GitHub and can be `org--project--repo--branch`
 * for Azure DevOps, which is why the prefix is built from all path components
 * rather than from an owner/name pair.
 */
export interface RepositoryMatchInfo {
  parsed: RepositoryIdentity;
  prefix: string | null;
  repositoryLeaf: string | null;
  branchPart: string | null;
  leafBranchSuffix: string | null;
  hasBranch: boolean;
}

/** A generated wiki's manifest, as the provider writes it. */
export interface WikiManifest {
  schema_version?: number;
  wiki_id?: string;
  wiki_title?: string;
  description?: string;
  wiki_version_id?: string;
  created_at?: string;
  canonical_repo_identifier?: string;
  repository?: string;
  branch?: string;
  pages?: string[];
  provider_type?: string;
}

/** One object in an artifact bucket listing. */
export interface WikiObject {
  key: string;
  size_bytes: number;
  media_type?: string;
  etag?: string;
  modified_at?: string;
}

/**
 * A toolkit's stored configuration, as the settings screens produce it.
 *
 * Deliberately an index signature. The legacy readers accept a dozen aliases
 * for the same field — `github_repository`, `toolkit_configuration_github_repository`,
 * `repository`, `repo` — because the shape has accumulated over several
 * settings screens, and a closed interface here would silently drop the alias a
 * given project happens to be stored under.
 */
export type ToolkitSettings = Record<string, unknown>;

/** A toolkit as the platform returns it. */
export interface Toolkit {
  toolkit_config?: ToolkitSettings;
  configuration?: { parameters?: ToolkitSettings };
  settings?: ToolkitSettings;
}
