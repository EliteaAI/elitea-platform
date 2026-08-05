import { useEffect } from 'react';

import { DEFAULT_PARTICIPANT_NAME } from '@/shared/lib/copy';

import { getEliteATitleValidationError, isValidEliteATitle } from './eliteaTitle';
import { getPropValue } from './getPropValue';
import { getIntegerConstraints, isIntegerType, validateIntegerConstraints, validateRequiredFields } from '../../../lib/helpers/toolBase.helpers';
import type { ToolBasePropertyFormState } from './ToolBaseProperty';
import type { EditToolField, ToolSchema } from './types';

/**
 * `ToolBase.tsx`'s four mount/update effects, split out to stay under the
 * §3.5 400-line file budget — a file-organization change only. Ported from
 * `ToolBase.jsx:78-178`'s four `useEffect` blocks.
 */

/** Ported from `ToolBase.jsx:88-114`. */
export function useRequiredFieldsValidation(
  schema: ToolSchema,
  settings: Readonly<Record<string, unknown>>,
  sectionProps: readonly string[],
  enableEditEliteaTitle: boolean,
  setToolErrors: ToolBasePropertyFormState['setToolErrors'],
): void {
  useEffect(() => {
    const requiredPropertiesError = validateRequiredFields(schema, settings, sectionProps, enableEditEliteaTitle);
    setToolErrors?.((previous) => {
      const merged: Record<string, boolean | string> = { ...previous };
      for (const [key, value] of Object.entries(requiredPropertiesError)) {
        if (!value || typeof previous[key] !== 'string') merged[key] = value;
      }
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors the baseline's own dependency array (ToolBase.jsx:104-114).
  }, [schema, settings, sectionProps, enableEditEliteaTitle]);
}

/** Ported from `ToolBase.jsx:119-145`. */
export function useIntegerConstraintsValidation(
  schema: ToolSchema,
  settings: Readonly<Record<string, unknown>>,
  setToolErrors: ToolBasePropertyFormState['setToolErrors'],
): void {
  useEffect(() => {
    if (!schema.properties) return;
    const constraintErrors: Record<string, string> = {};
    for (const [propertyKey, propertySchema] of Object.entries(schema.properties)) {
      if (!propertySchema || !isIntegerType(propertySchema)) continue;
      const constraints = getIntegerConstraints(propertySchema);
      if (!constraints) continue;
      const currentValue = settings[propertyKey] as string | number | boolean | null | undefined;
      const errorMessage = validateIntegerConstraints(currentValue, constraints);
      if (errorMessage) constraintErrors[propertyKey] = errorMessage;
    }
    if (Object.keys(constraintErrors).length > 0) {
      setToolErrors?.((previous) => ({ ...previous, ...constraintErrors }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseline runs this once per `schema.properties` identity change only (ToolBase.jsx:119-145).
  }, [schema.properties]);
}

/** Ported from `ToolBase.jsx:147-169`. */
export function useInitRequiredFields(
  schema: ToolSchema,
  settings: Readonly<Record<string, unknown>>,
  sectionProps: readonly string[],
  shouldInitRequiredFields: boolean,
  editField: EditToolField,
): void {
  useEffect(() => {
    if (!shouldInitRequiredFields) return;
    for (const propertyKey of schema.required ?? []) {
      if (settings[propertyKey] !== undefined || sectionProps.includes(propertyKey)) continue;
      const propertySchema = schema.properties?.[propertyKey];
      editField(
        `settings.${propertyKey}`,
        getPropValue({
          schema,
          name: propertyKey,
          type: propertySchema?.type,
          format: propertySchema?.format,
          defaultValue: propertySchema?.default,
          items: propertySchema?.items,
          configuration_types: propertySchema?.configuration_types,
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseline runs this once on mount only (ToolBase.jsx:147-169, empty dep array).
  }, []);
}

/** Ported from `ToolBase.jsx:171-178`. `systemSenderName` is a fixed `DEFAULT_PARTICIPANT_NAME` — see `ToolBase.tsx`'s own module doc comment for the disclosed `useSystemSenderName` gap. */
export function useEliteaTitleValidation(
  settings: Readonly<Record<string, unknown>>,
  enableEditEliteaTitle: boolean,
  setToolErrors: ToolBasePropertyFormState['setToolErrors'],
): void {
  useEffect(() => {
    const eliteaTitle = settings['elitea_title'] as string | undefined;
    if (enableEditEliteaTitle && eliteaTitle && !isValidEliteATitle(eliteaTitle)) {
      const message = getEliteATitleValidationError(eliteaTitle, DEFAULT_PARTICIPANT_NAME);
      setToolErrors?.((previous) => ({ ...previous, elitea_title: message ?? false }));
    }
  }, [settings, enableEditEliteaTitle, setToolErrors]);
}
