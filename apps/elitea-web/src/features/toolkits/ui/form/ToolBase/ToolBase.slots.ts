import type { EditToolField, ToolErrors } from './types';

/**
 * Argument shape for `ToolBase.tsx`'s `slots.renderNameDescriptionInput` —
 * byte-for-byte the JSX props the baseline passes to `ToolkitForm.
 * NameDescriptionInput` (`ToolBase.jsx:226-244`), so the real component
 * (A4d, not yet landed in this worktree) can be plugged in with a
 * `(props) => <NameDescriptionInput {...props} />` render-prop once it
 * exists, no shape translation required.
 */
export interface NameDescriptionInputSlotProps {
  readonly type: string;
  readonly name: string;
  readonly toolkitName: string;
  readonly description: string;
  readonly editField: EditToolField;
  readonly showValidation: boolean;
  readonly toolErrors: ToolErrors;
  readonly showOnlyRequiredFields: boolean;
  readonly showOnlyConfigurationFields: boolean;
  readonly showNameFieldForcedly: boolean;
  readonly showToolkitIcon: boolean;
  readonly hideNameInput: boolean;
  readonly configurationTitle: string;
  readonly isMCP: boolean;
  readonly disabled: boolean;
}
