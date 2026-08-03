/**
 * Context-budget validation helpers — copied from the old-app's widget slice.
 *
 * Source: `apps/elitea-ui/src/[fsd]/widgets/context-budget/lib/validation.js`
 *
 * Only `handleConvertToNumberChange` is copied; it is a 3-line helper
 * that strips non-digit characters and sets a Formik field value.
 */

/**
 * Strips non-digit characters from `value`, converts to number (or empty
 * string), and sets the Formik field value.
 *
 * Mirrors `handleConvertToNumberChange` from the old app's widget
 * validation module.
 */
export function handleConvertToNumberChange(
  value: string,
  formikField: string,
  setFormikValue: (field: string, value: number | string) => void,
): void {
  const digitsOnly = value.replace(/[^0-9]/g, '');
  const finalValue = digitsOnly !== '' ? Number(digitsOnly) : '';
  setFormikValue(formikField, finalValue);
}
