/**
 * CodePreview — main code preview container.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/OpenAITemplate/CodePreview.jsx`.
 */
import { memo, useMemo } from 'react';

import Box from '@mui/material/Box';

import CodePreviewContent from './CodePreviewContent';
import CodePreviewEmpty from './CodePreviewEmpty';
import CodePreviewHeader from './CodePreviewHeader';
import type { SxProps, Theme } from '@mui/material/styles';
import type { CSSProperties } from 'react';

interface CodePreviewProps {
  model: Record<string, unknown> | null;
  models: readonly Record<string, unknown>[];
  selectedModel: Record<string, unknown> | null;
  onChangeModel?: (model: Record<string, unknown>) => void;
  selectedLanguage: string;
  codeExample: string;
  editorLanguage: string;
  handleLanguageChange: (language: string) => void;
  sx?: SxProps<Theme>;
  onClose?: () => void;
  showCloseButton?: boolean;
}

export default memo(function CodePreview({
  model,
  models,
  selectedModel,
  onChangeModel,
  selectedLanguage,
  codeExample,
  editorLanguage,
  handleLanguageChange,
  sx,
  onClose,
  showCloseButton = true,
}: CodePreviewProps) {
  const styles = codePreviewStyles();

  const hasModelSelected = Boolean(model?.integration_name || model?.name);

  const containerSx = useMemo(() => {
    const result: (SxProps<Theme> | CSSProperties)[] = [styles.mainContainer];
    if (sx) {
      result.push(sx);
    }
    return result as SxProps<Theme>;
  }, [sx, styles.mainContainer]);

  return (
    <Box sx={containerSx}>
      <CodePreviewHeader
        selectedLanguage={selectedLanguage}
        onLanguageChange={handleLanguageChange}
        models={models}
        selectedModel={selectedModel}
        onChangeModel={onChangeModel}
        onClose={onClose}
        showCloseButton={showCloseButton}
      />

      <Box sx={styles.contentContainer}>
        {!hasModelSelected ? (
          <CodePreviewEmpty />
        ) : (
          <CodePreviewContent
            codeExample={codeExample}
            editorLanguage={editorLanguage}
            modelName={model?.model_name as string}
          />
        )}
      </Box>
    </Box>
  );
});

function codePreviewStyles() {
  return {
    mainContainer: {
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minHeight: '12.5rem',
    },
    contentContainer: {
      flex: 1,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    },
  };
}
