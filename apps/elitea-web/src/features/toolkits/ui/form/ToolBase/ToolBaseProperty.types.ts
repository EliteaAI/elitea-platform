import type { ChangeEvent } from 'react';

import type {
  CredentialLikeFieldContext,
  EditToolField,
  OnCredentialReload,
  OpenApiSpecFieldContext,
  SetToolErrors,
  ToolErrors,
  ToolPropertySchema,
  ToolSlotRenderer,
  ValidationErrorMessages,
} from './types';

/**
 * `ToolBaseProperty.tsx`'s prop-group interfaces, split out to stay under
 * the §3.5 400-line file budget — a file-organization change only, no
 * baseline equivalent. See `ToolBaseProperty.tsx`'s own module doc comment
 * for the full disclosed-redesign rationale.
 */
export interface ToolBasePropertyField {
  readonly key: string;
  readonly schema: ToolPropertySchema | undefined;
  readonly required: boolean;
  readonly editFieldRootPath?: string | undefined;
}

export interface ToolBasePropertyFormState {
  readonly toolErrors: ToolErrors;
  readonly setToolErrors?: SetToolErrors | undefined;
  readonly showValidation: boolean;
  readonly validationErrorMessages?: ValidationErrorMessages | undefined;
}

export interface ToolBasePropertyVisibility {
  readonly showOnlyRequiredFields?: boolean | undefined;
  readonly showOnlyConfigurationFields?: boolean | undefined;
  readonly disableConfigFields?: boolean | undefined;
  readonly noAccordionWrapper?: boolean | undefined;
}

export interface ToolBasePropertyCredentialContext {
  readonly specifiedProjectId?: string | number | undefined;
  readonly presetOptions?: unknown;
  readonly onCredentialReload?: OnCredentialReload | undefined;
}

export interface ToolBasePropertySlots {
  readonly renderOpenApiSpecField?: ToolSlotRenderer<OpenApiSpecFieldContext> | undefined;
  readonly renderCredentialLikeField?: ToolSlotRenderer<CredentialLikeFieldContext> | undefined;
}

export interface ToolBasePropertyProps {
  readonly field: ToolBasePropertyField;
  readonly formState: ToolBasePropertyFormState;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly editField: EditToolField;
  readonly handleInputChange: (fieldPath: string) => (event: ChangeEvent<HTMLInputElement>) => void;
  readonly visibility?: ToolBasePropertyVisibility | undefined;
  readonly disabled?: boolean | undefined;
  readonly credentialContext?: ToolBasePropertyCredentialContext | undefined;
  readonly slots?: ToolBasePropertySlots | undefined;
}
