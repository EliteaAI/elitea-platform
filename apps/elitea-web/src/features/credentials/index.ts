/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20
 * exported symbols, enforced by `scripts/check-budgets.mjs`; this file is
 * at the limit — trim an existing export before adding a new one).
 *
 * NOT exported here despite being fully built and tested (budget-forced —
 * see this unit's final report): `CredentialWarningModal`,
 * `CredentialWarningBanner`, `useCredentialWarningModal`. These are
 * cross-domain pieces (a toolkit/agent-authoring form's credential-change
 * warning, `entities/credential-warning` in the baseline) with no consumer
 * inside `pages/credentials` itself; `CredentialsSelect`/
 * `CredentialsControls`/`CredentialsTabBar` — the pieces this unit's own
 * pages actually compose, and the ones the manifest's ACT-039/040/041 name
 * directly — took the remaining budget. Whoever next needs the warning
 * trio can either free three slots here or import them once this slice's
 * public surface is revisited.
 */
export type { ConfigSchemaNode, ConfigurationTypeDescriptor } from './api/configurations';
export {
  useAvailableConfigurationsType,
  useConfigurationDetail,
  useConfigurationsList,
  useCreateConfiguration,
  useDeleteConfiguration,
  useTestConfigurationConnection,
  useUpdateConfiguration,
} from './api/useConfigurations';
export { classifySchemaField, initialDataForSchema } from './lib/schemaField';
export { extractInformationFromCredentialError } from './lib/credentialError';
export { generateCredentialTagList } from './lib/credentialTags';
export { normalizeCredentialPage } from './lib/normalizeCredential';
export { useCredentialValidation } from './model/useCredentialValidation';
export { CredentialsControls } from './ui/CredentialsControls';
export { CredentialsSelect } from './ui/CredentialsSelect';
export { CredentialsTabBar } from './ui/CredentialsTabBar';
