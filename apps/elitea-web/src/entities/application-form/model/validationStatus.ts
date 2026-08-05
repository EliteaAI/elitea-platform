/**
 * Pure helpers ported from the baseline's
 * `apps/elitea-ui/src/hooks/application/useValidateApplicationVersion.js`
 * (Part 3 of the Wave-2 promotion pass — see the promotion report for the
 * full per-file judgment).
 *
 * **What is deliberately NOT here: a `useValidateApplicationVersion` hook.**
 * The baseline hook drives per-tool "this toolkit is misconfigured" error
 * badges from `useValidateApplicationVersionQuery`, whose 400 response body
 * carries `toolkit_errors`. This app's generated client DOES export a
 * same-named hook — `useValidateApplicationVersion` in
 * `shared/api/generated/applications/applications.ts` — but it is a
 * different, narrower endpoint: `GET .../version_validator/prompt_lib/...`,
 * documented in its own generated comment as "internal/api/v2/eliteacore/
 * handler.go:1239-1249 — existence check only; responds {"valid": bool}"
 * (`VersionValidatorResponse = { valid: boolean }`, verified by reading
 * `versionValidatorResponse.zod.ts` directly — no `toolkit_errors` field
 * anywhere on it). Grepping the entire generated client for
 * `toolkit_errors`/`ToolkitError` turns up zero hits. There is currently NO
 * generated endpoint that reproduces the baseline's toolkit-validation
 * behaviour — a real backend gap, not a porting shortcut. Wrapping the
 * `valid: boolean` endpoint and pretending it were the old one would be
 * actively wrong, so no hook is exported here. Only the transport-agnostic
 * parsing/keying logic — useful the moment a real endpoint exists — is
 * ported. `ui/ApplicationValidator.tsx` takes the validation call as an
 * injected prop for the same reason.
 */

/** Cache/lookup key for one application-version's validation info. */
export function buildApplicationValidationKey(
  projectId: string | undefined,
  applicationId: number | string | undefined,
  versionId: number | string | undefined,
): string {
  return `${String(projectId)}_${String(applicationId)}_${String(versionId)}`;
}

/** A tool entry shaped like a sub-agent/pipeline reference (an `application`-type tool). */
export interface SubApplicationToolRef {
  readonly type?: string;
  readonly settings?: {
    readonly application_id?: string | number;
    readonly application_version_id?: string | number;
  };
}

/**
 * The validation key for a sub-agent/pipeline tool's OWN application
 * version (distinct from the parent version's key) — `null` when `tool`
 * isn't a resolvable `application`-type reference.
 */
export function subApplicationValidationKey(
  projectId: string | undefined,
  tool: SubApplicationToolRef | undefined,
): string | null {
  if (
    tool?.type !== 'application' ||
    tool.settings?.application_id === undefined ||
    tool.settings.application_id === '' ||
    tool.settings?.application_version_id === undefined ||
    tool.settings.application_version_id === ''
  ) {
    return null;
  }
  return buildApplicationValidationKey(projectId, tool.settings.application_id, tool.settings.application_version_id);
}

/**
 * Filters a version's `tools[]` down to the `application`-type entries that
 * reference another agent/pipeline as a sub-tool — the baseline's
 * `ApplicationValidator.jsx` `applicationTools` `useMemo`, extracted as a
 * standalone pure selector so it is usable without mounting the component.
 */
export function subApplicationTools<T extends SubApplicationToolRef>(tools: readonly T[] | undefined): readonly T[] {
  if (!tools?.length) return [];
  return tools.filter(
    (tool) => tool.type === 'application' && tool.settings?.application_id && tool.settings?.application_version_id,
  );
}

/**
 * Parses a pydantic-formatted validation message that encodes a structured
 * error as JSON text, e.g.
 * `"Value error, {\"error_type\": \"private_credential_not_found\", ...}"`.
 * Returns the parsed object when recognised (has an `error_type`),
 * otherwise returns the original string unchanged.
 */
export function parseApplicationValidationMessage(message: string | undefined): unknown {
  if (!message) return message;
  const VALUE_ERROR_PREFIX = 'Value error, ';
  const body = message.startsWith(VALUE_ERROR_PREFIX) ? message.slice(VALUE_ERROR_PREFIX.length) : message;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'error_type' in parsed) return parsed;
  } catch {
    // Not JSON — fall through and return the original string.
  }
  return message;
}
