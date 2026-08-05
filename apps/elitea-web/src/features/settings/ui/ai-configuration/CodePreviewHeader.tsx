/**
 * CodePreviewHeader — language selector and model selector.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/OpenAITemplate/CodePreviewHeader.jsx`.
 */
import { memo, useCallback, useMemo } from 'react';
import { useTheme, type Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';

import { SingleSelect } from '@/shared/ui/SingleSelect';
import { CODE_EXAMPLE_LABELS } from '@/features/settings/lib/ai-configuration/codeExamples';
import { t } from '@/shared/ui/lib/t';
import type { SingleSelectOption } from '@/shared/ui/SingleSelectMenuItem';

export interface CodePreviewHeaderProps {
  selectedLanguage: string;
  onLanguageChange: (language: string) => void;
  models: readonly Record<string, unknown>[];
  selectedModel: Record<string, unknown> | null;
  onChangeModel?: ((model: Record<string, unknown>) => void) | undefined;
  onClose?: (() => void) | undefined;
  showCloseButton?: boolean;
}

export default memo(function CodePreviewHeader({
  selectedLanguage,
  onLanguageChange,
  models,
  selectedModel,
  onChangeModel,
  onClose,
  showCloseButton = false,
}: CodePreviewHeaderProps) {
  const theme = useTheme();
  const styles = codePreviewHeaderStyles(theme);

  const languageOptions = useMemo((): SingleSelectOption[] => {
    return Object.keys(CODE_EXAMPLE_LABELS).map((key) => ({
      label: CODE_EXAMPLE_LABELS[key] as string,
      value: key,
    }));
  }, []);

  const modelOptions = useMemo((): SingleSelectOption[] => {
    return models.map((model) => ({
      value: `${(model.name as string) ?? ''}<<>>${(model.project_id as string) ?? ''}`,
      label: (model.display_name as string) || (model.name as string) || '',
    }));
  }, [models]);

  const onHandleChangeModel = useCallback(
    (selectedValue: string) => {
      const [modelName, projectId] = selectedValue.split('<<>>');
      const foundModel = models.find(
        (model) => model.name === modelName && String(model.project_id) === projectId,
      );
      if (foundModel) {
        onChangeModel?.(foundModel);
      }
    },
    [models, onChangeModel],
  );

  return (
    <Box sx={styles.headerContainer}>
      <Box sx={styles.controlsContainer}>
        <SingleSelect
          label={t('ai-configuration.codePreview.model', 'Model:')}
          value={`${(selectedModel?.name as string) ?? ''}<<>>${(selectedModel?.project_id as string) ?? ''}`}
          onChange={onHandleChangeModel}
          options={modelOptions}
          disabled={false}
        />
        <SingleSelect
          label={t('ai-configuration.codePreview.language', 'Code:')}
          value={selectedLanguage}
          onChange={onLanguageChange}
          options={languageOptions}
          disabled={false}
        />
        {showCloseButton && (
          <IconButton color="secondary" onClick={onClose}>
            <CloseIcon sx={{ width: '1rem', height: '1rem' }} />
          </IconButton>
        )}
      </Box>
    </Box>
  );
});

function codePreviewHeaderStyles(theme: ReturnType<typeof useTheme>) {
  const t = theme as Theme;
  return {
    headerContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '1.5rem',
      padding: '0.5rem 0.75rem',
      borderBottom: `1px solid ${t.vars.palette.border.lines}`,
      minHeight: '3rem',
      flexShrink: 0,
    },
    controlsContainer: { display: 'flex', alignItems: 'center', gap: '2rem' },
  };
}
