// @ts-nocheck
/**
 * OpenAITemplate page — OpenAI-compatible API code examples.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/OpenAITemplate/OpenAITemplate.jsx`.
 */
import { useCallback, useState } from 'react';
import { useTheme, type Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileDownloadIcon from '@mui/icons-material/FileDownload';

import { t } from '@/shared/i18n';
import { isPublicProject } from '@/entities/project';
import { getConfig } from '@/shared/config';

import CodePreview from './CodePreview';
import { useCodePreview } from '@/features/settings/lib/ai-configuration/useCodePreview';
import { useModelsQuery } from '@/features/settings/api/ai-configuration/api';
import { removeDuplicateModels } from '@/features/settings/lib/ai-configuration/modelConfiguration.helpers';
import { useModelConfiguration } from '@/features/settings/lib/ai-configuration/useModelConfiguration';
import type { ModelInfo } from '@/entities/credential';

export interface OpenAITemplateProps {
  /** Currently-selected project id — threaded down from the route. */
  projectId: string;
}

export default function OpenAITemplate({ projectId }: OpenAITemplateProps) {
  const theme = useTheme();
  const styles = getStyles(theme);

  /* `include_shared: projectId != PUBLIC_PROJECT_ID` — old app:
     `OpenAITemplate.jsx:31`. */
  const includeShared = (() => {
    const result = getConfig();
    if (result.status !== 'ok') return true;
    return !isPublicProject(projectId, result.config.vite_public_project_id);
  })();

  /* Source models straight from the models-with-defaults endpoint (old app:
     `useListModelsQuery({ section: 'llm', ... })`, `OpenAITemplate.jsx:19-33`)
     — NOT the general configurations-list endpoint, which carries no real
     `default` flag. `ModelInfo.default` here is the actual backend value. */
  const { data: modelsData } = useModelsQuery(projectId, 'llm', includeShared);

  /* Remove duplicates — old app pattern */
  const uniqueConfigurations = removeDuplicateModels(
    modelsData ? [...modelsData.items] : ([] as ModelInfo[]),
  );

  /* Model state management — real `projectId` (not `null`) re-enables the
     project-scoped "auto-select default on initial load" effect inside
     `useModelConfiguration`. */
  const { model, selectedModelFromConfigurations, onChangeModel } = useModelConfiguration({
    projectId,
    configurations: uniqueConfigurations,
  });

  /* Code preview */
  const { selectedLanguage, codeExample, editorLanguage, handleLanguageChange, handleCopy } = useCodePreview(model, projectId);

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
              <IconButton color="secondary" onClick={() => void handleCopyClick()}>
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
          sx={{ fontSize: theme.typography.headingSmall.fontSize }}
        >
          {t('ai-configuration.openaiTemplate.copied', 'Code copied to clipboard')}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function getStyles(theme: ReturnType<typeof useTheme>) {
  const t = theme as Theme;
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
      fontSize: (theme as Theme).typography.headingSmall.fontSize,
      fill: t.vars.palette.icon.fill.disabled,
    },
  };
}
