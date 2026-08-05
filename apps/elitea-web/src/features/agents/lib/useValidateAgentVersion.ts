import { useValidateApplicationVersion } from '@/shared/api/generated/applications/applications';
import type { UseValidateVersion } from '@/entities/application-form';

/**
 * `entities/application-form`'s own `ValidateVersionArgs`/
 * `ValidateVersionResult` interfaces exist (`ui/ApplicationValidator.tsx`)
 * but are not re-exported from that slice's curated `index.ts` (only
 * `ApplicationValidatorProps`/`UseValidateVersion` are, staying under the
 * §3.5 budget) — derived here via utility types instead of duplicating
 * the shape by hand, so this stays byte-in-sync with the real function
 * type automatically.
 */
type ValidateVersionArgs = Parameters<UseValidateVersion>[0];
type ValidateVersionResult = ReturnType<UseValidateVersion>;

/**
 * The `useValidate` implementation `entities/application-form`'s
 * `ApplicationValidator` takes as an injected prop (see that component's
 * own doc comment: "the validation call itself is dependency-injected via
 * the `useValidate` prop"). Wraps the REAL, but narrower-than-baseline,
 * generated `useValidateApplicationVersion` (`{valid: boolean}` existence
 * check, no `toolkit_errors` detail — the already-documented gap).
 *
 * `enabled` gating mirrors `widgets/sidebar/api/usePermissionSet.ts`'s own
 * convention: `useValidateApplicationVersion` requires non-optional
 * `string`/`number` params, so this always calls the hook (rules-of-hooks:
 * unconditional call count) with safe fallback values (`''`/`0`) and
 * disables the actual network request until every real id is known.
 */
export const useValidateAgentVersion: UseValidateVersion = ({ projectId, applicationId, versionId }: ValidateVersionArgs): ValidateVersionResult => {
  const enabled = projectId !== undefined && applicationId !== undefined && versionId !== undefined;
  const query = useValidateApplicationVersion(projectId ?? '', applicationId ?? 0, versionId ?? 0, {
    query: { enabled },
  });
  return { isError: enabled && query.isError, error: query.error };
};
