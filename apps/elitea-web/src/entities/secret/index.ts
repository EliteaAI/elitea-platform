/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { RevealedSecret, Secret } from './model/types';
export { filterSecretsByName, isSecretHideable, maskSecretValue } from './model/selectors';
