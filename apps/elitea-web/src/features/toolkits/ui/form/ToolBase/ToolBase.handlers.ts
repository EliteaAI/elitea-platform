import type { ChangeEvent } from 'react';

import { MAX_NAME_LENGTH } from '@/shared/lib/limits';

import { convertToValidEliteaTitle } from './eliteaTitle';
import { getIntegerConstraints, isIntegerType, validateIntegerConstraints } from '../../../lib/helpers/toolBase.helpers';
import type { ToolBasePropertyFormState } from './ToolBaseProperty';
import type { EditToolField, ToolPropertySchema, ToolSchema } from './types';

/**
 * `ToolBase.tsx`'s `handleInputChange` factory, split into its own file —
 * same complexity-budget reason as `ToolBase.options.ts`. Ported verbatim
 * from `ToolBase.jsx:180-218`.
 */
export interface CreateHandleInputChangeParams {
  readonly schema: ToolSchema;
  readonly setToolErrors: ToolBasePropertyFormState['setToolErrors'];
  readonly editField: EditToolField;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly onConfigurationNameChange: ((value: string) => void) | undefined;
}

/** The integer-masking + pattern-guard half of `handleInputChange` — split out to keep the returned closure's own complexity low. */
function sanitizeInputValue(
  initialValue: string,
  propertySchema: ToolPropertySchema | undefined,
  setToolErrors: ToolBasePropertyFormState['setToolErrors'],
  propertyKey: string,
): string | undefined {
  if (!propertySchema) return initialValue;

  let processedValue = initialValue;
  if (isIntegerType(propertySchema)) {
    processedValue = initialValue.replace(/[^0-9]/g, '');
    const constraints = getIntegerConstraints(propertySchema);
    const errorMessage = validateIntegerConstraints(processedValue, constraints);
    setToolErrors?.((previous) => ({ ...previous, [propertyKey]: errorMessage || false }));
  }
  const { pattern } = propertySchema as ToolPropertySchema & { pattern?: string };
  if (pattern && processedValue !== '' && !new RegExp(pattern).test(processedValue)) {
    return undefined;
  }
  return processedValue;
}

export function createHandleInputChange({ schema, setToolErrors, editField, settings, onConfigurationNameChange }: CreateHandleInputChangeParams) {
  return (fieldPath: string) => (event: ChangeEvent<HTMLInputElement>) => {
    const propertyKey = fieldPath.replace('settings.', '');
    const propertySchema = schema.properties?.[propertyKey];
    const processedValue = sanitizeInputValue(event.target.value, propertySchema, setToolErrors, propertyKey);
    if (processedValue === undefined) return;

    editField(fieldPath, processedValue);
    if (fieldPath === 'settings.label') {
      const convertedEliteaTitle = convertToValidEliteaTitle(processedValue);
      if (settings['elitea_title'] !== convertedEliteaTitle) {
        editField('settings.elitea_title', convertedEliteaTitle);
      }
    } else if (fieldPath === 'settings.elitea_title') {
      editField('settings.elitea_title', processedValue.substring(0, MAX_NAME_LENGTH).toLowerCase());
    }
    if ((fieldPath === 'settings.elitea_title' || fieldPath === 'title') && onConfigurationNameChange) {
      onConfigurationNameChange(processedValue);
    }
  };
}
