/**
 * Legacy API-error-shape helpers ported from
 * apps/elitea-ui/src/common/utils.jsx (unit S3, spec §9.3).
 *
 * `err` here is the RTK-Query `FetchBaseQueryError`-flavoured shape the old
 * app's Redux data layer produced (`status`/`originalStatus` +
 * `data.{message,error,errors}` or `data` itself being a FastAPI/Pydantic
 * validation-error array). The new app's transport (`shared/api/http.ts`,
 * unit F4) returns a different discriminated `HttpResult`/`HttpFailure`
 * shape (§3.6) — these helpers are ported for PARITY of the message-
 * selection LOGIC (106 call sites across the old app depend on it), not
 * because the input shape is what the new transport produces. A Wave-2
 * feature unit wiring a TanStack Query error into UI copy will need to
 * either adapt the error at the call site to this shape or extend this
 * function; flagged in the S3 report rather than silently reshaping it.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** @public Wave-1 surface: type-only, for Wave-2 features shaping FastAPI/Pydantic validation-error payloads. */
export interface ErrorDetail {
  readonly msg?: string;
  readonly loc?: readonly (string | number)[];
}

function isErrorDetail(value: unknown): value is ErrorDetail {
  return isRecord(value);
}

function isNullOrUndefinedLocal(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/** `true` when `err.status` is `404` or `400` (old-app `utils.jsx:143`). */
export function isNotFoundError(err: unknown): boolean {
  return isRecord(err) && (err.status === 404 || err.status === 400);
}

/**
 * Context the old app read from the global Redux store to build the 403
 * message (`state.user.personal_project_id`, `state.settings.project`).
 * §2.3/R-S1/R-S2 remove the global store from the new architecture, so this
 * is now an explicit parameter rather than a `store.getState()` read — a
 * REQUIRED signature deviation (N4), not a silent behaviour change: the
 * message-selection logic for every branch, including this one, is
 * byte-for-byte identical to the old app once the project context is
 * supplied. Omitting `projectContext` reproduces the old app's own
 * "nothing loaded yet" fallback (`actualProjectName` falsy → "this
 * project").
 */
export interface ProjectContextForErrorMessage {
  readonly projectName?: string | null;
  readonly hasPersonalProject?: boolean;
}

function forbiddenProjectMessage(projectContext: ProjectContextForErrorMessage | undefined): string {
  const actualProjectName = projectContext?.projectName || (projectContext?.hasPersonalProject ? 'Private' : null);
  const projectText = actualProjectName ? `${actualProjectName} project` : 'this project';
  return `Insufficient permissions to perform this action\non ${projectText}.`;
}

/** `data.error`'s own sub-shape dispatch (old-app `utils.jsx:160-167`). */
function messageFromDataError(error: unknown): unknown {
  if (typeof error === 'string') {
    return error;
  }
  if (Array.isArray(error)) {
    const first: unknown = error[0];
    return (isErrorDetail(first) && first.msg) || 'Unknown error occurred';
  }
  return error;
}

/** FastAPI/Pydantic-style validation-error array (old-app `utils.jsx:171-181`). */
function messageFromValidationArray(data: readonly unknown[]): string | undefined {
  const messages = data
    .filter((item): item is ErrorDetail => isErrorDetail(item) && !isNullOrUndefinedLocal(item.msg))
    .map((item) => (item.loc ? `${item.msg} at ${item.loc.join(', ')}` : item.msg));
  return messages.length > 0 ? messages.join(',\n') : undefined;
}

/**
 * Resolves whichever of `data.message` / `data.error` / `data.errors` /
 * "`data` itself is a validation-error array" applies. Split out of
 * `buildErrorMessage` purely to keep both functions under the §3.5
 * cyclomatic-complexity budget — the branch order and semantics are
 * unchanged from the old app (`utils.jsx:157-181`).
 */
function resolveFromErrorData(data: unknown): unknown {
  if (isRecord(data) && data.message) {
    return data.message;
  }
  if (isRecord(data) && data.error) {
    return messageFromDataError(data.error);
  }
  if (isRecord(data) && data.errors) {
    return Object.values(data.errors).join('\n');
  }
  if (Array.isArray(data) && data.length > 0) {
    return messageFromValidationArray(data);
  }
  return undefined;
}

/**
 * Selects a human-readable message (or, in some branches, the raw
 * error-data value — see below) from an RTK-Query-shaped error.
 *
 * Preserved quirk (N4, old-app `utils.jsx:145-183`): this function's
 * return type is NOT reliably `string`. The `data.error` branch returns
 * `data.error` itself verbatim when it is neither a string nor an array
 * (e.g. an object) — the return type here is `unknown` to reflect that
 * honestly rather than force a stringification the old app never
 * performed.
 */
export function buildErrorMessage(err: unknown, projectContext?: ProjectContextForErrorMessage): unknown {
  if (isRecord(err) && err.originalStatus === 404) {
    return 'The requested resource was not found!';
  }
  if (isRecord(err) && err.status === 403) {
    return forbiddenProjectMessage(projectContext);
  }

  const data = isRecord(err) ? err.data : undefined;
  const resolved = resolveFromErrorData(data);
  if (resolved !== undefined) {
    return resolved;
  }

  return typeof err === 'string' ? err : data;
}
