/**
 * CodePreviewContent — renders the code example in a read-only CodeMirror editor.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/OpenAITemplate/CodePreviewContent.jsx`.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';

import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';
import { t } from '@/shared/ui/lib/t';

interface CodePreviewContentProps {
  codeExample: string;
  editorLanguage: string;
  modelName?: string;
}

export default memo(function CodePreviewContent({ codeExample, editorLanguage, modelName }: CodePreviewContentProps) {
  const styles = codePreviewContentStyles();

  return (
    <Box sx={styles.codeEditorContainer}>
      <CodeMirrorEditor
        key={`code-preview-${editorLanguage}-${modelName || 'default'}`}
        value={codeExample}
        readOnly={true}
        height="100%"
        minHeight="100%"
        aria-label={t('ai-configuration.codePreview.content.ariaLabel', 'Code example')}
      />
    </Box>
  );
});

function codePreviewContentStyles() {
  return {
    codeEditorContainer: (theme: Theme) => ({
      height: '100%',
      overflowY: 'auto',
      overflowX: 'auto',
      display: 'flex',
      flexDirection: 'column',
      '&::-webkit-scrollbar': { width: '0.25rem', height: '0.25rem' },
      '&::-webkit-scrollbar-track': { background: theme.vars.palette.background.eliteaDefault },
      '&::-webkit-scrollbar-thumb': { background: theme.vars.palette.scrollbar.thumb, borderRadius: 'var(--el-shape-radiusSm, 4px)' },
      '&::-webkit-scrollbar-thumb:hover': { background: theme.vars.palette.scrollbar.thumbHover },
      '& .cm-editor': { height: 'auto', minHeight: '100%', maxHeight: 'none' },
      '& .cm-scroller': { overflow: 'visible', maxHeight: 'none' },
    }),
  };
}
