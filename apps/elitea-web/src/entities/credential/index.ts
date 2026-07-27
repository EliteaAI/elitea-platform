/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Credential, CredentialPage } from './model/types';
export {
  credentialDisplayName,
  credentialScope,
  credentialUrl,
  providerDisplayName,
  sortCredentialsPinnedFirst,
} from './model/selectors';
