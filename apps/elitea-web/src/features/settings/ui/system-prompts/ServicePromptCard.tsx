/**
 * ServicePromptCard — renders a single prompt card with edit/restore buttons.
 */
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import RestoreOutlinedIcon from '@mui/icons-material/RestoreOutlined';
import EditIcon from '@mui/icons-material/Edit';

import { t } from '@/shared/i18n';
import { promptsStyles } from './ServicePrompts.styles';

interface PromptConfig {
  id: number;
  key: string;
  label: string;
  prompt: string;
}

export interface ServicePromptCardProps {
  item: PromptConfig;
  hasDefault: boolean;
  isBusy: boolean;
  canEdit: boolean;
  onEdit: (config: PromptConfig) => void;
  onRestore: (config: PromptConfig) => void;
}

export function ServicePromptCard({
  item,
  hasDefault,
  isBusy,
  canEdit,
  onEdit,
  onRestore,
}: ServicePromptCardProps) {
  const preview = buildPreview(item.prompt);

  return (
    <Box key={item.id} sx={promptsStyles.card}>
      <Box sx={promptsStyles.cardContent}>
        <Box sx={promptsStyles.cardText}>
          <Typography variant="bodyMedium" sx={promptsStyles.cardHeading}>
            {item.label}
          </Typography>
          <Typography variant="bodySmall" sx={promptsStyles.cardSubheading}>
            {item.key}
          </Typography>
          <Typography variant="bodySmall" sx={promptsStyles.cardPreview}>
            {preview}
          </Typography>
        </Box>
        <Box sx={promptsStyles.cardActions}>
          <Tooltip title={t('shared.ui.settings.prompts.editTooltip', 'Edit')} placement="top">
            <Box component="span">
              <IconButton
                color="tertiary"
                onClick={() => onEdit(item)}
                disabled={!canEdit || isBusy}
                aria-label={t('shared.ui.settings.prompts.editAria', 'Edit service prompt {{key}}', { key: item.key })}
                sx={promptsStyles.editButton}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Box>
          </Tooltip>
          <Tooltip
            title={hasDefault
              ? t('shared.ui.settings.prompts.restoreTooltip', 'Restore to default')
              : t('shared.ui.settings.prompts.noDefaultTooltip', 'No default available')
            }
            placement="top"
          >
            <Box component="span">
              <IconButton
                color="tertiary"
                onClick={() => onRestore(item)}
                disabled={!canEdit || !hasDefault || isBusy}
                aria-label={t('shared.ui.settings.prompts.restoreAria', 'Restore prompt {{key}} to default', { key: item.key })}
                sx={promptsStyles.restoreButton}
              >
                <RestoreOutlinedIcon fontSize="small" />
              </IconButton>
            </Box>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  );
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function buildPreview(promptText: string): string {
  if (!promptText) return t('shared.ui.settings.prompts.notConfigured', 'Not configured');
  const lines = String(promptText).split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return t('shared.ui.settings.prompts.notConfigured', 'Not configured');
  const previewText = lines.slice(0, 2).join(' ');
  return previewText.length > 140 ? `${previewText.slice(0, 140)}…` : previewText;
}
