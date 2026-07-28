import type { ReactNode } from 'react';

import type { ToolBasePropertyCredentialContext, ToolBasePropertyFormState, ToolBasePropertySlots } from './ToolBaseProperty';
import type { ToolSectionSubsection } from './ToolSection';
import type { EditToolDetail, EditToolField, SetEditToolDetail, ToolSchema, ToolSlotRenderer } from './types';
import type { NameDescriptionInputSlotProps } from './ToolBase.slots';

/**
 * `ToolBase.tsx`'s prop-group interfaces, split out to stay under the §3.5
 * 400-line file budget — a file-organization change only, no baseline
 * equivalent (the baseline destructures 28 flat props, `ToolBase.jsx:26-57`).
 * See `ToolBase.tsx`'s own module doc comment for the full disclosed-
 * redesign rationale behind each group.
 */
export interface ToolBaseToolDetail {
  readonly value: EditToolDetail;
  readonly onChange: SetEditToolDetail;
}

export interface ToolBaseFieldVisibility {
  readonly showOnlyRequiredFields?: boolean | undefined;
  readonly showOnlyConfigurationFields?: boolean | undefined;
  readonly showNameFieldForcedly?: boolean | undefined;
  readonly showToolkitIcon?: boolean | undefined;
  readonly hideNameDescriptionInput?: boolean | undefined;
  readonly hideNameInput?: boolean | undefined;
  readonly disabledConfigFieldsForOldToolkits?: boolean | undefined;
  readonly checkboxAsteriskRequired?: boolean | undefined;
  readonly shouldInitRequiredFields?: boolean | undefined;
  readonly showSections?: boolean | undefined;
  readonly showTools?: boolean | undefined;
  readonly isMCP?: boolean | undefined;
}

export interface ToolBaseFieldOrder {
  readonly editFieldRootPath?: string | undefined;
  readonly priorityFieldsOrder?: readonly string[] | undefined;
  readonly fieldNeedToRenderAtBottom?: readonly string[] | undefined;
  readonly excludedFields?: readonly string[] | undefined;
  readonly advancedFields?: readonly string[] | undefined;
}

export interface ToolBaseSections {
  readonly sections: Readonly<Record<string, { required: boolean; subsections: readonly ToolSectionSubsection[] }>>;
  readonly sectionProps: readonly string[];
}

export interface ToolBaseSlots extends ToolBasePropertySlots {
  readonly renderNameDescriptionInput?: ToolSlotRenderer<NameDescriptionInputSlotProps> | undefined;
  readonly mcpAuthStatus?: ReactNode;
  readonly sharepointOAuthStatus?: ReactNode;
  readonly openApiOAuthStatus?: ReactNode;
  readonly toolActionsExtra?:
    | {
        readonly onLoadTools?: (() => void) | undefined;
        readonly isLoadingTools?: boolean | undefined;
        readonly canLoadTools?: boolean | undefined;
        readonly mcpAuthModal?: ReactNode;
      }
    | undefined;
}

export interface ToolBaseContext {
  readonly shouldUseAccordionView?: boolean | undefined;
}

export interface ToolBaseProps {
  readonly toolDetail: ToolBaseToolDetail;
  readonly editField: EditToolField;
  readonly formState: ToolBasePropertyFormState;
  readonly schema: ToolSchema;
  readonly onConfigurationNameChange?: ((value: string) => void) | undefined;
  readonly fieldVisibility?: ToolBaseFieldVisibility | undefined;
  readonly fieldOrder?: ToolBaseFieldOrder | undefined;
  readonly disabled?: boolean | undefined;
  readonly credentialContext?: ToolBasePropertyCredentialContext | undefined;
  readonly slots?: ToolBaseSlots | undefined;
  readonly context?: ToolBaseContext | undefined;
  readonly sections?: ToolBaseSections | undefined;
}
