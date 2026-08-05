/**
 * Public API — spec §3.3: named exports only.
 */
export type { RevealedSecret, Secret } from './model/types';
export { filterSecretsByName, isSecretHideable, maskSecretValue } from './model/selectors';
export type { SecretRow, SecretMutations } from './model/hooks';
export { useSecretsActions } from './model/hooks';
export {
  listSecrets,
  useListSecretsQuery,
  useCreateSecretMutation,
  useUpdateSecretMutation,
  useDeleteSecretMutation,
  useHideSecretMutation,
  showSecret,
} from './api/secretApi';
