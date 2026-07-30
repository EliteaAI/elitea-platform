/**
 * OpenAITemplate page — OpenAI-compatible API code examples.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/OpenAITemplate/OpenAITemplate.jsx`.
 */
import { useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileDownloadIcon from '@mui/icons-material/FileDownload';

import { t } from '@/shared/ui/lib/t';

import CodePreview from './CodePreview';
import { useCodePreview } from '@/routes/_shell/settings/ai-configuration/useCodePreview';
import { useModelConfiguration } from '@/routes/_shell/settings/ai-configuration/useModelConfiguration';
import { removeDuplicateModels } from '@/routes/_shell/settings/ai-configuration/modelConfiguration.helpers';
import type { ModelInfo } from '@/entities/credential/model/types';

export default function OpenAITemplate() {
  const styles = getStyles();

  const [models] = useMemo(() => [[], []] as unknown[], []);

  const uniqueConfigurations = useMemo(() => {
    return removeDuplicateModels(models as Array<Record<string, unknown>>);
  }, [models]);

  const { model, selectedModelFromConfigurations, onChangeModel } = useModelConfiguration({
    projectId: null,
    configurations: uniqueConfigurations as unknown as ModelInfo[],
  });

  const { selectedLanguage, codeExample, editorLanguage, handleLanguageChange, handleCopy, handleDownload } = useCodePreview(model);

  const hasModelSelected = Boolean(model?.integration_name || model?.name);

  const handleCopyClick = useCallback(() => { void handleCopy(); }, [handleCopy]);
  const handleDownloadClick = useCallback(() => { handleDownload(); }, [handleDownload]);

  return (
    <Box sx={styles.container}>
      <Box sx={styles.mainContainer}>
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
              <IconButton color="secondary" onClick={handleDownloadClick}>
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
