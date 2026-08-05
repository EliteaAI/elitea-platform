/**
 * ServicePromptsBody — renders the prompt cards grid and editor modal.
 *
 * Extracted from `ServicePromptsSection.tsx` to keep that file under 400 lines.
 *
 * Prop budget (≤ 12 §3.5) maintained via grouped interfaces.
 */
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Snackbar from '@mui/material/Snackbar';

import type { PromptConfig } from './ServicePrompts.types';
import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { t } from '@/shared/ui/lib/t';
import { ServicePromptCard } from './ServicePromptCard';
import { PromptEditorModal } from './PromptEditorModal';
import { promptsStyles } from './ServicePrompts.styles';

// ---------------------------------------------------------------------------
// Grouped prop interfaces (§3.5 component-props budget)
// ---------------------------------------------------------------------------

interface HeaderInfo {
  createTooltip: string;
  modalTitle: string;
}

interface PromptData {
  prompts: PromptConfig[];
  hasDefaultPrompt: (key: string) => boolean;
}

interface EditorState {
  isOpen: boolean;
  allowedKeys: string[];
  usedKeysRef: React.RefObject<Set<string>>;
  modeRef: React.RefObject<'create' | 'edit' | null>;
  draftKey: string;
  draftPrompt: string;
  onDraftKeyChange: (val: string) => void;
  onDraftPromptChange: (val: string) => void;
  onRestoreInModal: () => void;
}

interface PromptActions {
  handleOpenCreate: () => void;
  handleOpenEdit: (config: PromptConfig) => void;
  handleDiscard: () => void;
  handleSave: () => Promise<void>;
  handleRestoreToDefault: (config: PromptConfig) => Promise<void>;
  onDismissError: () => void;
}

interface EditorFlags {
  isBusy: boolean;
  hasAvailableKeys: boolean;
  hasDefault: boolean;
  hasChanges: boolean;
  canEdit: boolean;
  errorMessage: string | null;
}

interface ServicePromptsBodyProps {
  header: HeaderInfo;
  promptData: PromptData;
  editor: EditorState;
  actions: PromptActions;
  flags: EditorFlags;
}

// ---------------------------------------------------------------------------
// Component (5 grouped props)
// ---------------------------------------------------------------------------

export function ServicePromptsBody({
  header, promptData, editor, actions, flags,
}: ServicePromptsBodyProps) {
  return (
    <>
      <DrawerPageHeader
        title={t('shared.ui.settings.prompts.title', 'Service Prompts')}
        showAddButton
        slotProps={{
          addButton: {
            onAdd: actions.handleOpenCreate,
            disabled: !flags.canEdit || !flags.hasAvailableKeys || flags.isBusy,
            tooltip: header.createTooltip,
          },
        }}
      />
      <Box sx={promptsStyles.wrapper}>
        <Box sx={promptsStyles.cards}>
          {promptData.prompts.map((item) => (
            <ServicePromptCard
              key={item.id}
              item={item}
              hasDefault={promptData.hasDefaultPrompt(item.key)}
              isBusy={flags.isBusy}
              canEdit={flags.canEdit}
              onEdit={(config) => actions.handleOpenEdit(config)}
              onRestore={() => {
                void actions.handleRestoreToDefault(
                  promptData.prompts.find(p => p.key === item.key) as PromptConfig,
                );
              }}
            />
          ))}
        </Box>

        {editor.isOpen && (
          <PromptEditorModal config={{
            open: editor.isOpen,
            onClose: actions.handleDiscard,
            title: header.modalTitle,
            isBusy: flags.isBusy,
            hasDefault: flags.hasDefault,
            hasChanges: flags.hasChanges,
            readOnly: !flags.canEdit,
            onDiscard: actions.handleDiscard,
            onSave: () => void actions.handleSave(),
            onRestore: editor.onRestoreInModal,
            mode: editor.modeRef.current,
            draftKey: editor.draftKey,
            draftPrompt: editor.draftPrompt,
            allowedKeys: editor.allowedKeys,
            usedKeys: editor.usedKeysRef.current,
            onDraftKeyChange: editor.onDraftKeyChange,
            onDraftPromptChange: editor.onDraftPromptChange,
            styles: promptsStyles,
          }} />
        )}
      </Box>

      <Snackbar
        open={Boolean(flags.errorMessage)}
        autoHideDuration={5000}
        onClose={actions.onDismissError}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={actions.onDismissError} severity="error" variant="filled">
          {flags.errorMessage}
        </Alert>
      </Snackbar>
    </>
  );
}
