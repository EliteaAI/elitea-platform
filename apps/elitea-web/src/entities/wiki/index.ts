/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 *
 * It carries only what a consumer imports TODAY, and grows one phase at a time.
 * `gate-dead-code` runs knip at `--max-issues 0`, so an export published ahead
 * of its consumer fails the build — which is the rule working: a helper with no
 * caller is dead code whether or not a barrel names it.
 *
 * The identity helpers are the reason this is an entity and not a feature:
 * every wiki feature needs them, and `no-sideways-features` forbids one feature
 * importing another.
 */
export type { RepositoryIdentity, ToolkitSettings, WikiManifest } from './model/types';
export { filterManifestsByRepo } from './lib/repoMatch';
// Added in P5, when the settings feature became its first consumer.
export { getConfiguredRepoIdentity } from './lib/toolkitSettings';
export { fetchWikiManifest, fetchWikiPage, listWikiObjects, manifestKeys } from './api/wikiArtifactsApi';
export { useWikiToolkit, useWikiToolkits } from './api/wikiToolkitApi';
