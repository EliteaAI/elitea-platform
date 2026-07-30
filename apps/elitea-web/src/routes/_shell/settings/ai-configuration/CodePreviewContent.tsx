/**
 * CodePreviewContent — renders the code example in a read-only CodeMirror editor.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/OpenAITemplate/CodePreviewContent.jsx`.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';
import { t } from '@/shared/ui/lib/t';

export interface CodePreviewContentProps {
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

function codePreviewContentStyles(): { codeEditorContainer: SxProps<Theme> } {
  return {
    codeEditorContainer: {
      height: '100%',
      overflowY: 'auto',
      overflowX: 'auto',
      display: 'flex',
      flexDirection: 'column',
      '&::-webkit-scrollbar': { width: '0.25rem', height: '0.25rem' },
      '&::-webkit-scrollbar-track': { background: '#1a1b26' },
      '&::-webkit-scrollbar-thumb': { background: '#414868', borderRadius: '0.125rem' },
      '&::-webkit-scrollbar-thumb:hover': { background: '#565f8e' },
      '& .cm-editor': { height: 'auto !important', minHeight: '100%', maxHeight: 'none !important' },
      '& .cm-scroller': { overflow: 'visible !important', maxHeight: 'none !important' },
    },
  };
}
