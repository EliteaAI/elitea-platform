/**
 * Public API — spec §3.3: named exports only.
 */
export type { RevealedSecret, Secret } from './model/types';
export { filterSecretsByName, isSecretHideable, maskSecretValue } from './model/selectors';
export type { SecretRow, SecretMutations } from './model/hooks';
export { useSecretsActions } from './model/hooks';
/** #441: the caller half `shared/ui`'s `SecretField` needs — see `model/useSecretFieldOptions.ts`. The pure helpers in that module stay intra-slice; only the hook crosses the barrel. */
export { useSecretFieldOptions } from './model/useSecretFieldOptions';
export {
  listSecrets,
  useListSecretsQuery,
  useCreateSecretMutation,
  useUpdateSecretMutation,
  useDeleteSecretMutation,
  useHideSecretMutation,
  showSecret,
} from './api/secretApi';
