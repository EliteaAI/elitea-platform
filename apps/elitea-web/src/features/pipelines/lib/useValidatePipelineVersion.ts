import { useValidateApplicationVersion } from '@/shared/api/generated/applications/applications';
import type { UseValidateVersion } from '@/entities/application-form';

/**
 * Local, `features/pipelines`-owned duplicate of `features/agents/lib/
 * useValidateAgentVersion.ts` — the `useValidate` implementation
 * `entities/application-form`'s `ApplicationValidator` takes as an injected
 * prop (see that component's own doc comment: "the validation call itself
 * is dependency-injected via the `useValidate` prop"). A pipeline version
 * IS an application version (`entities/pipeline/model/types.ts`'s own
 * "Pipeline literally IS an Application row" doc comment), so the same real
 * generated endpoint validates it — this is a straight duplicate of the
 * agents-side wiring, not a different implementation, kept local because
 * `no-sideways-features` forbids importing `features/agents/lib/
 * useValidateAgentVersion.ts` directly.
 *
 * Same narrower-than-baseline caveat as the agents copy: wraps the REAL but
 * narrower generated `useValidateApplicationVersion` (`{valid: boolean}`
 * existence check, no `toolkit_errors` detail — the already-documented gap,
 * see `entities/application-form/model/validationStatus.ts`).
 */
type ValidateVersionArgs = Parameters<UseValidateVersion>[0];
type ValidateVersionResult = ReturnType<UseValidateVersion>;

export const useValidatePipelineVersion: UseValidateVersion = ({ projectId, applicationId, versionId }: ValidateVersionArgs): ValidateVersionResult => {
  const enabled = projectId !== undefined && applicationId !== undefined && versionId !== undefined;
  const query = useValidateApplicationVersion(projectId ?? '', applicationId ?? 0, versionId ?? 0, {
    query: { enabled },
  });
  return { isError: enabled && query.isError, error: query.error };
};
