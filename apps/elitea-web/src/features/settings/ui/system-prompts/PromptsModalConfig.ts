/**
 * PromptsModalConfig — shared config interface for the prompt editor modal.
 * Extracted here to break the circular dependency:
 *   ServicePromptsSection.tsx → PromptEditorModal.tsx → ServicePromptsSection.tsx
 *
 * depcruise (Gates R-L3): module A must not depend on module B that depends
 * on module A.  By sharing a types-only file, both sides depend on the type
 * contract without creating a runtime cycle.
 */
import type { SxProps, Theme } from '@mui/material/styles';

export interface PromptsModalConfig {
  open: boolean;
  onClose: () => void;
  title: string;
  isBusy: boolean;
  hasDefault: boolean;
  hasChanges: boolean;
  readOnly: boolean;
  onDiscard: () => void;
  onSave: () => void;
  onRestore: () => void;
  mode: 'create' | 'edit' | null;
  draftKey: string;
  draftPrompt: string;
  allowedKeys: string[];
  usedKeys: Set<string>;
  onDraftKeyChange: (val: string) => void;
  onDraftPromptChange: (val: string) => void;
  styles: Record<string, SxProps<Theme>>;
}
