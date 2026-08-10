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
import { t } from '@/shared/i18n';

import type { PromptsModalConfig } from './PromptsModalConfig';

export const PromptEditorModal = ({ config }: { config: PromptsModalConfig }): React.ReactElement | null => {
  if (!config.open) return null;

  return (
    <ExpandedViewerModal
      open={config.open}
      onClose={config.onClose}
      title={config.title}
      header={{
        customButtons: (
          <Tooltip
            title={config.hasDefault
              ? t('shared.ui.settings.prompts.restoreTooltip', 'Restore to default')
              : t('shared.ui.settings.prompts.noDefaultTooltip', 'No default available')
            }
            placement="top"
          >
            <Box component="span" sx={config.styles.modalRestoreWrapper}>
              <IconButton
                color="tertiary"
                onClick={config.onRestore}
                disabled={!config.hasDefault || config.isBusy || config.readOnly}
                aria-label={t('shared.ui.settings.prompts.restoreInModalAria', 'Restore to default')}
              >
                <RestoreOutlinedIcon fontSize="small" />
              </IconButton>
            </Box>
          </Tooltip>
        ),
      }}
      footer={
        <Box sx={config.styles.modalFooter}>
          <Button variant="outlined" onClick={config.onDiscard} disabled={config.isBusy}>
            {t('shared.ui.settings.prompts.discard', 'Discard')}
          </Button>
          <Button
            variant="contained"
            onClick={config.onSave}
            disabled={config.isBusy || !config.hasChanges || config.readOnly}
          >
            {t('shared.ui.settings.prompts.save', 'Save')}
          </Button>
        </Box>
      }
      content={
        <Box sx={config.styles.modalBody}>
          <Box sx={config.styles.keyRow}>
            <TextField
              select
              label={t('shared.ui.settings.prompts.keyLabel', 'Key')}
              size="small"
              value={config.draftKey}
              onChange={(e) => { config.onDraftKeyChange(e.target.value); }}
              disabled={config.mode === 'edit'}
              helperText={
                config.mode === 'create'
                  ? t('shared.ui.settings.prompts.keyHelpCreate', 'Select a predefined key')
                  : t('shared.ui.settings.prompts.keyHelpEdit', 'Key is immutable')
              }
              fullWidth
            >
              {config.allowedKeys.map((key) => (
                <MenuItem key={key} value={key} disabled={config.mode === 'create' && config.usedKeys.has(key)}>
                  {key}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <Box sx={config.styles.editorContainer}>
            <CodeMirrorEditor
              readOnly={config.readOnly}
              value={config.draftPrompt}
              onChange={config.onDraftPromptChange}
              height="100%"
              minHeight="100%"
            />
          </Box>
        </Box>
      }
    />
  );
};
