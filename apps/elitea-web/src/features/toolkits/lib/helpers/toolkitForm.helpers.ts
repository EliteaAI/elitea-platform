/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/helpers/
 * toolkitForm.helpers.js` (81 lines, Wave-2 unit A4b). Parses a toolkit
 * settings-validation error entry (`msg`/`loc` shape, matching a Pydantic
 * `ValidationError`) into a `{fieldKey, message}` pair, unwrapping the
 * server's Python-repr'd JSON body some error types embed inside `msg`
 * (`"Value error, {...}"` where `{...}` is Python `repr()`, not JSON —
 * single-quoted strings, `True`/`False`/`None`).
 *
 * `CONFIGURATION_VIEW_OPTIONS` is NOT duplicated here: the Wave-2 promotion
 * pass already ported this exact baseline literal (`{ConfigurationSelect:
 * 'configuration', CredentialsSelect: 'credentials'}`) into `entities/
 * toolkit`'s `model/toolConfigurationMode.ts` (see that file's own doc
 * comment) — re-exported below for this module's callers instead of a
 * second, independently-maintained copy.
 */
export { CONFIGURATION_VIEW_OPTIONS } from '@/entities/toolkit';

const VALUE_ERROR_PREFIX = 'Value error, ';

/** Python `repr()` -> JSON: single-quoted strings to double-quoted, `True`/`False`/`None` to their JSON equivalents. Not a general Python-literal parser — only what the specific error bodies below actually emit. */
function pythonToJson(str: string): string {
  return str.replace(/'/g, '"').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null');
}

interface ParsedErrorBody {
  readonly error_type?: string;
  readonly model_name?: string;
  readonly __connection_errors__?: readonly ConnectionErrorEntry[];
  readonly [key: string]: unknown;
}

interface ConnectionErrorEntry {
  readonly message?: string;
  readonly configuration_type?: string;
}

interface ErrorHandlerResult {
  readonly message: string;
}

const ERROR_HANDLERS: Readonly<Record<string, (parsed: ParsedErrorBody) => ErrorHandlerResult>> = {
  configuration_model_not_found: (parsed) => ({
    message: `Model "${String(parsed.model_name)}" is no longer available in project configurations.`,
  }),
  credential_not_found: () => ({
    message: 'Your configuration does not match any available configurations.',
  }),
  private_credential_not_found: () => ({
    message: 'Your private configuration does not match any available configurations.',
  }),
};

interface ConnectionErrorResult {
  readonly message: string;
  readonly fieldKey: string | undefined;
}

function handleConnectionErrors(parsed: ParsedErrorBody): ConnectionErrorResult | null {
  const connError = parsed.__connection_errors__?.[0];
  if (!connError) return null;

  return {
    message: connError.message || 'Connection error',
    fieldKey: connError.configuration_type !== undefined ? `${connError.configuration_type}_configuration` : undefined,
  };
}

function parseErrorBody(body: string): ParsedErrorBody | null {
  try {
    return JSON.parse(pythonToJson(body)) as ParsedErrorBody;
  } catch {
    return null;
  }
}

export interface ValidationErrorEntry {
  readonly msg?: string;
  readonly loc?: readonly unknown[];
}

export interface ParsedValidationError {
  readonly fieldKey: string | undefined;
  readonly message: string;
}

/**
 * Parses one settings-validation error entry. When `msg` embeds a
 * recognised structured body (`configuration_model_not_found`/
 * `credential_not_found`/`private_credential_not_found`/a
 * `__connection_errors__` array), returns a friendlier message for the
 * relevant field; otherwise falls back to the raw `msg` keyed by
 * `loc[1]` (the field name — `loc[0]` is always the containing object,
 * e.g. `'settings'`). Returns `null` only when there is neither a parseable
 * body nor a usable `loc[1]`.
 */
/** `loc[1]` is always the field name when present, but arrives typed as `unknown` (a Pydantic `loc` tuple can carry an index/int too) — narrowed to the two scalar kinds ever actually seen. */
function locFieldKey(loc: readonly unknown[] | undefined): string | undefined {
  const locField = loc?.[1];
  return typeof locField === 'string' || typeof locField === 'number' ? String(locField) : undefined;
}

/**
 * The "recognised structured body" half of `parseValidationError`, split
 * out to stay under the §3.5 complexity budget: an `ERROR_HANDLERS` match
 * wins first, then a `__connection_errors__` entry (whose own `fieldKey`,
 * when present, overrides the outer `loc[1]`-derived one — the baseline's
 * `connResult.fieldKey ?? fieldKey`). `null` when neither matches.
 */
function resolveStructuredError(parsed: ParsedErrorBody, outerFieldKey: string | undefined): ParsedValidationError | null {
  const handler = parsed.error_type !== undefined ? ERROR_HANDLERS[parsed.error_type] : undefined;
  if (handler) return { fieldKey: outerFieldKey, message: handler(parsed).message };

  const connResult = handleConnectionErrors(parsed);
  if (connResult) return { fieldKey: connResult.fieldKey ?? outerFieldKey, message: connResult.message };

  return null;
}

export function parseValidationError(curr: ValidationErrorEntry): ParsedValidationError | null {
  const msg = curr.msg ?? '';
  const fieldKey = locFieldKey(curr.loc);

  const body = msg.startsWith(VALUE_ERROR_PREFIX) ? msg.slice(VALUE_ERROR_PREFIX.length) : msg;

  const parsed = parseErrorBody(body);
  if (!parsed) return fieldKey !== undefined ? { fieldKey, message: msg } : null;

  return resolveStructuredError(parsed, fieldKey) ?? (fieldKey !== undefined ? { fieldKey, message: msg } : null);
}

/** Reduces a `settings_errors` array into a `{fieldKey: message}` map, dropping entries `parseValidationError` couldn't key to a field. */
export function parseValidationErrors(settingsErrors: readonly ValidationErrorEntry[] = []): Record<string, string> {
  return settingsErrors.reduce<Record<string, string>>((acc, curr) => {
    const result = parseValidationError(curr);
    if (result?.fieldKey !== undefined) {
      acc[result.fieldKey] = result.message;
    }
    return acc;
  }, {});
}
