/**
 * ProjectContextBody and ProjectContextToasts — extracted sub-components
 * for the project context settings page.
 *
 * Extracted from `ProjectContextContent.tsx` to keep that file under 400 lines.
 */
import Box from '@mui/material/Box';
import Snackbar from '@mui/material/Snackbar';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';

import Alert from '@mui/material/Alert';
import { BannerMessage } from '@/shared/ui/BannerMessage';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { DrawerPage } from '@/routes/_shell/settings/DrawerPage';
import { t } from '@/shared/i18n';
import { projectContextStyles } from './ProjectContextContent.styles';
import { ProjectParamsHeader } from './ProjectParamsHeader';
import { EnableToggleCard } from './EnableToggleCard';
import { EditorSection } from './EditorSection';

export interface ProjectContextBodyProps {
  projectId: string;
  projectName: string;
  enabled: boolean;
  showReadOnlyBanner: boolean;
  showDisabledBanner: boolean;
  showEditorContent: boolean;
  content: string;
  mode: 'edit' | 'preview';
  isEditorFocused: boolean;
  showEditorControls: boolean;
  canEdit: boolean;
  isDirty: boolean;
  isSaving: boolean;
  handleToggle: (checked: boolean) => void;
  handleContentChange: (val: string) => void;
  handleModeChange: (_e: React.SyntheticEvent, newValue: 'edit' | 'preview') => void;
  handleEditorBlur: (e: React.FocusEvent) => void;
  handleAIGenerated: (content: string) => void;
  handleIconChange: (iconName: string | null) => Promise<void>;
  handleSave: () => Promise<void>;
  handleDiscard: () => void;
  onFocus: () => void;
}

export function ProjectContextBody({
  projectId,
  projectName,
  enabled,
  showReadOnlyBanner,
  showDisabledBanner,
  showEditorContent,
  content,
  mode,
  isEditorFocused,
  showEditorControls,
  canEdit,
  isDirty,
  isSaving,
  handleToggle,
  handleContentChange,
  handleModeChange,
  handleEditorBlur,
  handleAIGenerated,
  handleIconChange,
  handleSave,
  handleDiscard,
  onFocus,
}: ProjectContextBodyProps) {
  const theme = useTheme();
  const s = projectContextStyles;
  return (
    <Box sx={s.root}>
      <DrawerPage>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '1rem 1.5rem',
            borderBottom: `1px solid ${theme.vars.palette.border.lines}`,
          }}
        >
          <Typography variant="headingSmall" color="text.secondary">
            {t('entities.projectContext.content.title', 'Project Context')}
          </Typography>
        </Box>

        <Box sx={s.body}>
          <ProjectParamsHeader
            projectId={projectId}
            projectName={projectName}
            onIconChange={(iconName: string | null) => void handleIconChange(iconName)}
          />

          {showReadOnlyBanner && (
            <BannerMessage
              message={t('entities.projectContext.content.readOnlyBanner', "You don't have permission to edit this setting.")}
              variant="info"
            />
          )}

          <EnableToggleCard enabled={enabled} onToggle={handleToggle} />

          {showDisabledBanner && (
            <BannerMessage
              message={t('entities.projectContext.content.disabledBanner', 'Project Context is turned off. The project background is not applied to AI responses or workflows.')}
              variant="info"
            />
          )}

          {showEditorContent && (
            <EditorSection
              content={content}
              mode={mode}
              isEditorFocused={isEditorFocused}
              showEditorControls={showEditorControls}
              canEdit={canEdit}
              onContentChange={handleContentChange}
              onModeChange={handleModeChange}
              onFocus={onFocus}
              onBlur={handleEditorBlur}
              onAIGenerated={handleAIGenerated}
            />
          )}

          <Box sx={s.actions}>
            <BaseBtn
              variant="contained"
              color="primary"
              disabled={!canEdit || !isDirty || isSaving}
              onClick={() => void handleSave()}
            >
              {t('entities.projectContext.content.save', 'Save')}
            </BaseBtn>
            <BaseBtn
              variant="secondary"
              color="secondary"
              disabled={!canEdit || !isDirty}
              onClick={() => handleDiscard()}
            >
              {t('entities.projectContext.content.discard', 'Discard')}
            </BaseBtn>
          </Box>
        </Box>
      </DrawerPage>
    </Box>
  );
}

export interface ProjectContextToastsProps {
  showSaveToast: boolean;
  showErrorToast: boolean;
  onCloseSave: () => void;
  onCloseError: () => void;
}

export function ProjectContextToasts({
  showSaveToast,
  showErrorToast,
  onCloseSave,
  onCloseError,
}: ProjectContextToastsProps) {
  return (
    <>
      <Snackbar
        open={showSaveToast}
        autoHideDuration={3000}
        onClose={onCloseSave}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={onCloseSave} severity="success" variant="filled">
          {t('entities.projectContext.content.saveSuccess', 'Project Context saved successfully')}
        </Alert>
      </Snackbar>
      <Snackbar
        open={showErrorToast}
        autoHideDuration={3000}
        onClose={onCloseError}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={onCloseError} severity="error" variant="filled">
          {t('entities.projectContext.content.saveError', 'Failed to save Project Context')}
        </Alert>
      </Snackbar>
    </>
  );
}
