/**
 * ServicePromptsBody — renders the prompt cards grid and editor modal.
 *
 * Extracted from `ServicePromptsSection.tsx` to keep that file under 400 lines.
 */
import Box from '@mui/material/Box';

import type { PromptConfig } from './ServicePrompts.types';
import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { t } from '@/shared/ui/lib/t';
import { ServicePromptCard } from './ServicePromptCard';
import { PromptEditorModal } from './PromptEditorModal';
import { promptsStyles } from './ServicePrompts.styles';

interface ServicePromptsBodyProps {
  createTooltip: string;
  modalTitle: string;
  handleOpenCreate: () => void;
  handleOpenEdit: (config: PromptConfig) => void;
  handleDiscard: () => void;
  handleSave: () => Promise<void>;
  handleRestoreToDefault: (config: PromptConfig) => Promise<void>;
  hasDefaultPrompt: (key: string) => boolean;
  prompts: PromptConfig[];
  isBusy: boolean;
  hasAvailableKeys: boolean;
  isOpen: boolean;
  allowedKeys: string[];
  usedKeysRef: React.RefObject<Set<string>>;
  hasDefault: boolean;
  hasChanges: boolean;
  onRestoreInModal: () => void;
  modeRef: React.RefObject<'create' | 'edit' | null>;
  draftKeyRef: React.RefObject<string>;
  draftPromptRef: React.RefObject<string>;
  onDraftKeyChange: (val: string) => void;
  onDraftPromptChange: (val: string) => void;
}

export function ServicePromptsBody({
  createTooltip,
  modalTitle,
  handleOpenCreate,
  handleOpenEdit,
  handleDiscard,
  handleSave,
  handleRestoreToDefault,
  hasDefaultPrompt,
  prompts,
  isBusy,
  hasAvailableKeys,
  isOpen,
  allowedKeys,
  usedKeysRef,
  hasDefault,
  hasChanges,
  onRestoreInModal,
  modeRef,
  draftKeyRef,
  draftPromptRef,
  onDraftKeyChange,
  onDraftPromptChange,
}: ServicePromptsBodyProps) {
  return (
    <>
      <DrawerPageHeader
        title={t('shared.ui.settings.prompts.title', 'Service Prompts')}
        showAddButton
        slotProps={{
          addButton: {
            onAdd: handleOpenCreate,
            disabled: !hasAvailableKeys || isBusy,
            tooltip: createTooltip,
          },
        }}
      />
      <Box sx={promptsStyles.wrapper}>
        <Box sx={promptsStyles.cards}>
          {prompts.map((item) => (
            <ServicePromptCard
              key={item.id}
              item={item}
              hasDefault={hasDefaultPrompt(item.key)}
              isBusy={isBusy}
              onEdit={(config) => handleOpenEdit(config)}
              onRestore={() => {
                void handleRestoreToDefault(prompts.find(p => p.key === item.key) as PromptConfig);
              }}
            />
          ))}
        </Box>

        {isOpen && (
          <PromptEditorModal config={{
            open: isOpen,
            onClose: handleDiscard,
            title: modalTitle,
            isBusy,
            hasDefault,
            hasChanges,
            onDiscard: handleDiscard,
            onSave: () => void handleSave(),
            onRestore: onRestoreInModal,
            mode: modeRef.current,
            draftKey: draftKeyRef.current,
            draftPrompt: draftPromptRef.current,
            allowedKeys,
            usedKeys: usedKeysRef.current,
            onDraftKeyChange,
            onDraftPromptChange,
            styles: promptsStyles,
          }} />
        )}
      </Box>
    </>
  );
}
