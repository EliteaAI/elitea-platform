import type { ReactNode } from 'react';
import { memo, useMemo } from 'react';

import { subApplicationTools, type SubApplicationToolRef } from '../model/validationStatus';

/**
 * `ApplicationValidator` — ported from
 * `apps/elitea-ui/src/pages/Applications/Components/Applications/
 * ApplicationValidator.jsx` (Wave-2 promotion pass, Part 1 file 3 of 7).
 *
 * **Real, load-bearing caveat — read before wiring this up:** the baseline
 * drives this component from `useValidateApplicationVersionQuery`
 * (RTK Query), whose 400 response carries `toolkit_errors` for per-tool
 * error badges. As documented in detail in `../model/validationStatus.ts`,
 * this app's generated client has NO endpoint that reproduces that
 * behaviour — the same-named `useValidateApplicationVersion` hook in
 * `shared/api/generated/applications/applications.ts` is a different,
 * narrower "does this version belong to this application" existence check
 * (`{ valid: boolean }`, no `toolkit_errors` field). Rather than silently
 * wiring this component to the WRONG endpoint (which would look like
 * validation but never actually surface a toolkit error), the validation
 * call itself is dependency-injected via the `useValidate` prop: this
 * component owns only the orchestration the baseline hard-coded internally
 * (which `application`-type tools need their own validation call, one
 * `SubApplicationValidator` render per tool, matching hook-call-count
 * rules) — a caller supplies `useValidate` once a real toolkit-validation
 * endpoint exists to wrap.
 */
/**
 * Not re-exported from `entities/application-form`'s curated `index.ts`
 * (that barrel is already at its §3.5 20-export budget cap — see this
 * slice's own `index.ts` doc comment). Every injected `useValidate`
 * implementation that needs these shapes (`features/agents/lib/
 * useValidateAgentVersion.ts`, `features/pipelines/lib/
 * useValidatePipelineVersion.ts`) derives them via `Parameters<
 * UseValidateVersion>[0]`/`ReturnType<UseValidateVersion>` instead of
 * importing them by name — both of those files' own doc comments disclose
 * this exact workaround. `export` stays unnecessary here: kept only for
 * `UseValidateVersion`'s own signature within this file.
 */
interface ValidateVersionArgs {
  readonly projectId: string | undefined;
  readonly applicationId: number | undefined;
  readonly versionId: number | undefined;
}

interface ValidateVersionResult {
  readonly isError: boolean;
  readonly error: unknown;
}

export type UseValidateVersion = (args: ValidateVersionArgs) => ValidateVersionResult;

export interface ApplicationValidatorProps {
  readonly projectId: string | undefined;
  readonly applicationId: number | undefined;
  readonly versionId: number | undefined;
  readonly tools: readonly SubApplicationToolRef[] | undefined;
  readonly skip?: boolean;
  readonly isCreateMode?: boolean;
  /** Injected rather than called internally — see the module doc comment. */
  readonly useValidate: UseValidateVersion;
  readonly onValidationError?: (result: ValidateVersionResult) => void;
}

interface SubApplicationValidatorProps {
  readonly projectId: string | undefined;
  readonly applicationId: number | undefined;
  readonly versionId: number | undefined;
  readonly useValidate: UseValidateVersion;
  /**
   * Required-but-possibly-`undefined` (not optional `?`) so this component
   * can forward `ApplicationValidator`'s own optional prop straight through
   * without an `exactOptionalPropertyTypes` mismatch — see the parent's
   * `onValidationError?:` for the caller-facing (genuinely optional) form.
   */
  readonly onValidationError: ((result: ValidateVersionResult) => void) | undefined;
}

/**
 * Split out of `ApplicationValidator` purely to keep the component's own
 * cyclomatic complexity under the oxlint budget (12) — this one boolean
 * combines 6 independent "don't validate yet" conditions.
 */
function shouldSkipValidation(
  props: Pick<ApplicationValidatorProps, 'skip' | 'isCreateMode' | 'applicationId' | 'projectId' | 'versionId' | 'tools'>,
): boolean {
  return (
    props.skip === true ||
    props.isCreateMode === true ||
    !props.applicationId ||
    !props.projectId ||
    !props.versionId ||
    !props.tools?.length
  );
}

const SubApplicationValidator = memo(function SubApplicationValidator({
  projectId,
  applicationId,
  versionId,
  useValidate,
  onValidationError,
}: SubApplicationValidatorProps): ReactNode {
  const result = useValidate({ projectId, applicationId, versionId });
  if (result.isError) onValidationError?.(result);
  return null;
});

export function ApplicationValidator({
  projectId,
  applicationId,
  versionId,
  tools,
  skip = false,
  isCreateMode = false,
  useValidate,
  onValidationError,
}: ApplicationValidatorProps): ReactNode {
  const shouldSkip = shouldSkipValidation({ skip, isCreateMode, applicationId, projectId, versionId, tools });

  const result = useValidate({
    projectId,
    applicationId,
    versionId: shouldSkip ? undefined : versionId,
  });
  if (!shouldSkip && result.isError) onValidationError?.(result);

  const applicationTools = useMemo(() => {
    if (shouldSkip) return [];
    return subApplicationTools(tools);
  }, [shouldSkip, tools]);

  return (
    <>
      {applicationTools.map((tool) => (
        <SubApplicationValidator
          key={`${String(tool.settings?.application_id)}-${String(tool.settings?.application_version_id)}`}
          projectId={projectId}
          applicationId={Number(tool.settings?.application_id)}
          versionId={Number(tool.settings?.application_version_id)}
          useValidate={useValidate}
          onValidationError={onValidationError}
        />
      ))}
    </>
  );
}
