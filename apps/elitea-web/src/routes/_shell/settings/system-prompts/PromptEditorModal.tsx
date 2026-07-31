/**
 * PromptEditorModal — create/edit dialog used inside ServicePromptsSection.
 * Extracted to keep ServicePromptsSection ≤ 400 lines (spec §3.5).
 */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';

import RestoreOutlinedIcon from '@mui/icons-material/RestoreOutlined';

import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';
import { ExpandedViewerModal } from '@/shared/ui/ExpandedViewerModal';

import type { PromptsModalProps } from './ServicePromptsSection';

export const PromptEditorModal = ({
  open,
  onClose,
  title,
  isBusy,
  hasDefault,
  hasChanges,
  onDiscard,
  onSave,
  onRestore,
  mode,
  draftKey,
  draftPrompt,
  allowedKeys,
  usedKeys,
  onDraftKeyChange,
  onDraftPromptChange,
  styles,
  tFn,
}: PromptsModalProps): React.ReactElement | null => {
  if (!open) return null;

  return (
    <ExpandedViewerModal
      open={open}
      onClose={onClose}
      title={title}
      header={{
        customButtons: (
          <Tooltip
            title={hasDefault
              ? tFn('shared.ui.settings.prompts.restoreTooltip', 'Restore to default')
              : tFn('shared.ui.settings.prompts.noDefaultTooltip', 'No default available')
            }
            placement="top"
          >
            <Box component="span" sx={styles.modalRestoreWrapper}>
              <IconButton
                color="tertiary"
                onClick={onRestore}
                disabled={!hasDefault || isBusy}
                aria-label={tFn('shared.ui.settings.prompts.restoreInModalAria', 'Restore to default')}
              >
                <RestoreOutlinedIcon fontSize="small" />
              </IconButton>
            </Box>
          </Tooltip>
        ),
      }}
      footer={
        <Box sx={styles.modalFooter}>
          <Button variant="outlined" onClick={onDiscard} disabled={isBusy}>
            {tFn('shared.ui.settings.prompts.discard', 'Discard')}
          </Button>
          <Button
            variant="contained"
            onClick={onSave}
            disabled={isBusy || !hasChanges}
          >
            {tFn('shared.ui.settings.prompts.save', 'Save')}
          </Button>
        </Box>
      }
      content={
        <Box sx={styles.modalBody}>
          <Box sx={styles.keyRow}>
            <TextField
              select
              label={tFn('shared.ui.settings.prompts.keyLabel', 'Key')}
              size="small"
              value={draftKey}
              onChange={(e) => { onDraftKeyChange(e.target.value); }}
              disabled={mode === 'edit'}
              helperText={
                mode === 'create'
                  ? tFn('shared.ui.settings.prompts.keyHelpCreate', 'Select a predefined key')
                  : tFn('shared.ui.settings.prompts.keyHelpEdit', 'Key is immutable')
              }
              fullWidth
            >
              {allowedKeys.map((key) => (
                <MenuItem key={key} value={key} disabled={mode === 'create' && usedKeys.has(key)}>
                  {key}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <Box sx={styles.editorContainer}>
            <CodeMirrorEditor
              readOnly
              value={draftPrompt}
              onChange={onDraftPromptChange}
              height="100%"
              minHeight="100%"
            />
          </Box>
        </Box>
      }
    />
  );
};
