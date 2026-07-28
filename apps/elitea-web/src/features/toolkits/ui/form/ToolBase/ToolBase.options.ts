import type { ToolBaseFieldOrder, ToolBaseFieldVisibility, ToolBaseSections } from './ToolBase.types';
import type { ToolSectionSubsection } from './ToolSection';

/**
 * `ToolBase.tsx`'s destructuring-default resolution, split into its own
 * file/functions: the baseline's 19 flat destructured defaults
 * (`ToolBase.jsx:26-57`) all live directly in the render function's own
 * body, and each default value is its own `eslint(complexity)` branch —
 * concentrating all 19 (plus every other conditional in a 612-line
 * component) in one function is exactly what scored the baseline-shaped
 * port a complexity of 69 (§3.5 budget: 12) before this split. Two small
 * groups here, each safely under budget; no behaviour change.
 */
export interface ResolvedFieldPresentation {
  readonly showOnlyRequiredFields: boolean;
  readonly showOnlyConfigurationFields: boolean;
  readonly showNameFieldForcedly: boolean;
  readonly showToolkitIcon: boolean;
  readonly hideNameDescriptionInput: boolean;
  readonly hideNameInput: boolean;
}

export function resolveFieldPresentation(v: ToolBaseFieldVisibility | undefined): ResolvedFieldPresentation {
  const {
    showOnlyRequiredFields = false,
    showOnlyConfigurationFields = false,
    showNameFieldForcedly = false,
    showToolkitIcon = false,
    hideNameDescriptionInput = false,
    hideNameInput = false,
  } = v ?? {};
  return { showOnlyRequiredFields, showOnlyConfigurationFields, showNameFieldForcedly, showToolkitIcon, hideNameDescriptionInput, hideNameInput };
}

export interface ResolvedFieldBehavior {
  readonly disabledConfigFieldsForOldToolkits: boolean;
  readonly checkboxAsteriskRequired: boolean;
  readonly shouldInitRequiredFields: boolean;
  readonly showSections: boolean;
  readonly showTools: boolean;
  readonly isMCP: boolean;
}

export function resolveFieldBehavior(v: ToolBaseFieldVisibility | undefined): ResolvedFieldBehavior {
  const {
    disabledConfigFieldsForOldToolkits = false,
    checkboxAsteriskRequired = true,
    shouldInitRequiredFields = true,
    showSections = false,
    showTools = true,
    isMCP = false,
  } = v ?? {};
  return { disabledConfigFieldsForOldToolkits, checkboxAsteriskRequired, shouldInitRequiredFields, showSections, showTools, isMCP };
}

export interface ResolvedFieldOrder {
  readonly editFieldRootPath: string;
  readonly priorityFieldsOrder: readonly string[];
  readonly fieldNeedToRenderAtBottom: readonly string[];
  readonly excludedFields: readonly string[];
  readonly advancedFields: readonly string[];
}

export function resolveFieldOrder(v: ToolBaseFieldOrder | undefined): ResolvedFieldOrder {
  const {
    editFieldRootPath = 'settings',
    priorityFieldsOrder = [],
    fieldNeedToRenderAtBottom = [],
    excludedFields = [],
    advancedFields = [],
  } = v ?? {};
  return { editFieldRootPath, priorityFieldsOrder, fieldNeedToRenderAtBottom, excludedFields, advancedFields };
}

export interface ResolvedSections {
  readonly sections: Readonly<Record<string, { required: boolean; subsections: readonly ToolSectionSubsection[] }>>;
  readonly sectionProps: readonly string[];
}

export function resolveSections(v: ToolBaseSections | undefined): ResolvedSections {
  return { sections: v?.sections ?? {}, sectionProps: v?.sectionProps ?? [] };
}
