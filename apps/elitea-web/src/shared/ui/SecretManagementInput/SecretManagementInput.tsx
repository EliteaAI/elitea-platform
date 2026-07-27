import type { ReactNode } from 'react';

import { SecretField, type SecretFieldSecretsOptions } from '../SecretField';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface SecretManagementInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Used as both the underlying control's DOM `id` and its HTML `name` attribute — see `SecretField`'s doc comment. */
  name?: string;
  required?: boolean;
  disabled?: boolean;
  error?: boolean;
  helperText?: string;
  /** Fires on blur — replaces the baseline's `onInputBlur`. */
  onSave?: () => void;
  /** Default `false`, matching the baseline's `SecretManagementInput` (unlike bare `SecretField`, which defaults it on). */
  passwordVisibilityToggle?: boolean;
  secrets?: SecretFieldSecretsOptions;
}

/**
 * A `SecretField` preset for credential-form usage: the show/hide toggle
 * defaults off (baseline default) and the `name` HTML attribute is exposed
 * for autofill. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/secret-field/SecretManagementInput.jsx`.
 *
 * **Deliberate API deviation:** the baseline resolved its own field label
 * from `authType`/`authTypes` (a lookup table of tool-credential auth
 * methods — entity-level knowledge `shared/ui` cannot import, layer rule
 * R-L1) via a `useEffect`/`useState` pair, and took `fieldPath`/`editField`
 * from a form-field-array API belonging to whatever `features/` form owned
 * it. Both are entity/feature concerns pushed to the caller: pass the
 * already-resolved `label` directly, and `value`/`onChange` as plain
 * controlled-input props instead of a field-array path. `SecretField`
 * itself documents the remaining Redux/RTK-Query/permissions deviations
 * (`secrets.onCreate`/`canCreate`/`onRefresh`) this component inherits
 * unchanged. The baseline's `containerProps`/`sx` override and
 * `tooltipDescription` are dropped for the same reasons `SecretField`'s own
 * doc comment gives.
 */
export function SecretManagementInput({
  value,
  onChange,
  label,
  name,
  required = true,
  disabled = false,
  error,
  helperText,
  onSave,
  passwordVisibilityToggle = false,
  secrets,
}: SecretManagementInputProps): ReactNode {
  return (
    <SecretField
      value={value}
      onChange={onChange}
      label={label}
      required={required}
      disabled={disabled}
      passwordVisibilityToggle={passwordVisibilityToggle}
      {...(name !== undefined ? { name } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(helperText !== undefined ? { helperText } : {})}
      {...(onSave !== undefined ? { onSave } : {})}
      {...(secrets !== undefined ? { secrets } : {})}
    />
  );
}
