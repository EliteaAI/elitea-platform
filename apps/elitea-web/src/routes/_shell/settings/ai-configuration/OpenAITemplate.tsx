/**
 * OpenAITemplate page — OpenAI-compatible API code examples.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/OpenAITemplate/OpenAITemplate.jsx`.
 */
import { useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileDownloadIcon from '@mui/icons-material/FileDownload';

import { t } from '@/shared/ui/lib/t';

import CodePreview from './CodePreview';
import { useCodePreview } from '@/routes/_shell/settings/ai-configuration/useCodePreview';
import { useConfigurationsBySection } from '@/routes/_shell/settings/ai-configuration/useConfigurationsBySection';
import { removeDuplicateModels } from '@/routes/_shell/settings/ai-configuration/modelConfiguration.helpers';
import { useModelConfiguration } from '@/routes/_shell/settings/ai-configuration/useModelConfiguration';
import type { ModelInfo } from '@/entities/credential/model/types';

export default function OpenAITemplate() {
  const styles = getStyles();

  /* Fetch all sections; we only need the LLM models for code preview */
  const { data: configSections } = useConfigurationsBySection();
  const llmConfigs = configSections?.['llm'] ?? [];

  /* Convert ConfigurationItem[] → ModelInfo-compatible array */
  const models = useMemo((): readonly Record<string, unknown>[] => {
    return llmConfigs.map((cfg) => ({
      id: cfg.id,
      name: cfg.elitea_title || cfg.label || cfg.type || '',
      display_name: cfg.elitea_title || cfg.label || '',
      type: cfg.type || '',
      label: cfg.label || cfg.elitea_title || cfg.type || '',
      project_id: cfg.project_id || '',
      default: false,
      integration_name: (cfg.data as Record<string, unknown>)?.integration_name as string | undefined,
    }));
  }, [llmConfigs]);

  /* Remove duplicates — old app pattern */
  const uniqueConfigurations = useMemo(() => {
    return removeDuplicateModels(models as Array<Record<string, unknown>>);
  }, [models]);

  /* Model state management */
  const { model, selectedModelFromConfigurations, onChangeModel } = useModelConfiguration({
    projectId: null,
    configurations: uniqueConfigurations as unknown as ModelInfo[],
  });

  /* Code preview */
  const { selectedLanguage, codeExample, editorLanguage, handleLanguageChange, handleCopy } = useCodePreview(model);

  const hasModelSelected = Boolean(model?.integration_name || model?.name);

  /* Download handler */
  const handleDownload = useCallback(() => {
    try {
      const fileName = 'api_example.py';
      const element = document.createElement('a');
      const file = new Blob([codeExample], { type: 'text/plain' });
      element.href = URL.createObjectURL(file);
      element.download = fileName;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      URL.revokeObjectURL(element.href);
    } catch {
      // Silently fail — download failures are not critical
    }
  }, [codeExample]);

  /* Copy with toast notification */
  const [copySuccess, setCopySuccess] = useState(false);
  const handleCopyClick = useCallback(async () => {
    try {
      await handleCopy();
      setCopySuccess(true);
    } catch {
      // Copy failed — no toast needed per the established pattern
    }
  }, [handleCopy]);

  return (
    <Box sx={styles.container}>
      <Box sx={styles.mainContainer}>
        {/* Action buttons — positioned over the code preview */}
        <Box sx={styles.buttons}>
          {hasModelSelected && (
            <Tooltip title={t('ai-configuration.openaiTemplate.copyTooltip', 'Copy to clipboard')} placement="top">
              <IconButton color="secondary" onClick={handleCopyClick}>
                <ContentCopyIcon sx={styles.actionIcon} />
              </IconButton>
            </Tooltip>
          )}
          {hasModelSelected && (
            <Tooltip title={t('ai-configuration.openaiTemplate.downloadTooltip', 'Download code example')} placement="top">
              <IconButton color="secondary" onClick={handleDownload}>
                <FileDownloadIcon sx={styles.actionIcon} />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        <CodePreview
          model={model}
          showCloseButton={false}
          models={uniqueConfigurations}
          selectedModel={selectedModelFromConfigurations as Record<string, unknown> | null}
          onChangeModel={onChangeModel as unknown as (m: Record<string, unknown>) => void}
          sx={styles.codePreview}
          selectedLanguage={selectedLanguage}
          codeExample={codeExample}
          editorLanguage={editorLanguage}
          handleLanguageChange={handleLanguageChange}
        />
      </Box>

      {/* Toast notification for successful copy */}
      <Snackbar
        open={copySuccess}
        autoHideDuration={2000}
        onClose={() => setCopySuccess(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setCopySuccess(false)}
          sx={{ fontSize: '0.875rem' }}
        >
          {t('ai-configuration.openaiTemplate.copied', 'Code copied to clipboard')}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function getStyles() {
  return {
    container: {
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      width: '100%',
    },
    mainContainer: {
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
    },
    codePreview: {
      height: '100%',
      minHeight: 0,
      width: '100%',
    },
    buttons: {
      position: 'absolute',
      top: '1rem',
      right: '1rem',
      display: 'flex',
      gap: '0.5rem',
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    actionIcon: {
      fontSize: '0.875rem',
      fill: '#757575',
    },
  };
}
