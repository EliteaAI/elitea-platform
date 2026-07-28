/**
 * Ported from `apps/elitea-ui/src/hooks/application/useValidateToolkit.js`
 * (Wave-2 promotion pass, Part 3).
 *
 * **What is deliberately NOT here: a `useValidateToolkit` hook.** The
 * baseline hook drives per-configuration "settings"/"connection" error
 * banners from `useValidateToolkitQuery`, whose failure response carries
 * `settings_errors`/`connection_errors`. Grepping the ENTIRE generated
 * client (`shared/api/generated/toolkits/toolkits.ts`) for `validate`
 * (case-insensitive) returns zero hits — only `useListToolkits` and
 * `useListToolkitInstances` exist. There is currently no generated endpoint
 * at all for toolkit validation, a real backend gap (paired with the
 * `entities/application-form` `validationStatus.ts` finding for
 * application-version validation — see the promotion report). Only the
 * transport-agnostic error-shape parser is ported; it is ready to wrap the
 * moment a real endpoint lands.
 */

interface SettingsErrorLike {
  readonly [key: string]: unknown;
}

interface ConnectionErrorLike {
  readonly message?: string;
  readonly configuration_title?: string;
  readonly configuration_type?: string;
  readonly requires_authorization?: boolean;
  readonly auth_metadata?: unknown;
}

export interface ToolkitValidationErrorEntry {
  readonly type?: 'connection_error';
  readonly msg?: string;
  readonly loc?: readonly (string | undefined)[];
  readonly requires_authorization?: boolean;
  readonly auth_metadata?: unknown;
  readonly [key: string]: unknown;
}

export interface ToolkitValidationErrorBody {
  readonly settings_errors?: readonly SettingsErrorLike[];
  readonly connection_errors?: readonly ConnectionErrorLike[];
}

/**
 * Combines `settings_errors` and `connection_errors` from a failed toolkit
 * validation response into ONE list, matching the baseline's
 * `useValidateToolkit.js`'s inline combination exactly (connection errors
 * are reshaped into the same `{type, msg, loc, ...}` entry shape settings
 * errors already use).
 */
export function toolkitValidationErrors(body: ToolkitValidationErrorBody | undefined): readonly ToolkitValidationErrorEntry[] {
  const settingsErrors = body?.settings_errors ?? [];
  const connectionErrors = (body?.connection_errors ?? []).map(
    (error): ToolkitValidationErrorEntry => ({
      type: 'connection_error',
      // `exactOptionalPropertyTypes` requires the conditional-spread pattern
      // (matching `entities/application/lib/normalise.ts`'s convention) —
      // an absent source field must produce an ABSENT target key, never a
      // present key holding `undefined`.
      ...(error.message !== undefined ? { msg: error.message } : {}),
      loc: [error.configuration_title ?? error.configuration_type],
      ...(error.requires_authorization !== undefined
        ? { requires_authorization: error.requires_authorization }
        : {}),
      ...(error.auth_metadata !== undefined ? { auth_metadata: error.auth_metadata } : {}),
    }),
  );
  return [...settingsErrors, ...connectionErrors];
}
