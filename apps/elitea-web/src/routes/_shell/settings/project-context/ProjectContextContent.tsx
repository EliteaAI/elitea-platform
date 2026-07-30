/**
 * ProjectContextContent — main content area for the Project Context settings
 * tab (Settings > Project Params > Project Context).
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/project-context/ProjectContextContent.jsx`.
 *
 * Uses:
 *  - Generated `useGetProjectContext` for context retrieval
 *  - Raw `updateProjectContext` (PUT) via `useMutation` for context updates
 *  - `GenerateProjectContextButton` for AI-generated drafts
 *  - `EnableToggleCard` (extracted) for the enable/disable toggle
 *  - `ProjectParamsHeader` for the project avatar + info row
 *  - `CodeMirrorEditor` for editing (no markdown extension — not installed)
 *  - `Markdown` for preview mode
 *  - `t()` for all text
 */
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { BannerMessage } from '@/shared/ui/BannerMessage';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { DrawerPage } from '@/routes/_shell/settings/DrawerPage';
import { ProjectParamsHeader } from './ProjectParamsHeader';
import { EnableToggleCard } from './EnableToggleCard';
import { EditorSection } from './EditorSection';
import { t } from '@/shared/i18n';
import {
  updateProjectContext,
  useGetProjectContext,
} from '@/shared/api/generated/applications/applications';
import { projectContextStyles } from './ProjectContextContent.styles';
import { useCallback, useEffect, useRef, useState } from 'react';

/* ── constants ─────────────────────────────────────────────────────────── */

const MAX_CHARS = 2500;

/* ── props ─────────────────────────────────────────────────────────────── */

export interface ProjectContextContentProps {
  projectId: string;
  projectName: string;
}

/* ── component ─────────────────────────────────────────────────────────── */

export function ProjectContextContent({
  projectId,
  projectName,
}: ProjectContextContentProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [isEditorFocused, setIsEditorFocused] = useState(false);

  /* ── project context data ─────────────────────────────────────────── */

  const { data: ctxResponse, isLoading } = useGetProjectContext(projectId, {
    query: { enabled: !!projectId },
  });

  const serverData = ctxResponse?.data;
  const isProjectContext =
    serverData && typeof serverData === 'object' && 'content' in serverData;

  /* ── update mutation ──────────────────────────────────────────────── */

  const saveMutation = useMutation({
    mutationFn: ({ content, enabled }: { content: string; enabled: boolean }) =>
      updateProjectContext(projectId, { content, enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [`/elitea_core/project_context/prompt_lib/${projectId}/project-context`] });
    },
  });

  /* ── local state ──────────────────────────────────────────────────── */

  const [content, setContent] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (isProjectContext && serverData !== undefined) {
      setContent(serverData.content ?? '');
      setEnabled(serverData.enabled ?? true);
      setIsDirty(false);
    }
  }, [isProjectContext, serverData]);

  /* ── derived state ──────────────────────────────────────────────── */

  const showReadOnlyBanner = true; // canView && !canEdit (placeholder)
  const showDisabledBanner = enabled === false && Boolean(content.trim());
  const showEditorContent = enabled || Boolean(content.trim());
  const showEditorControls = enabled && true; // enabled && canEdit

  /* ── event handlers ─────────────────────────────────────────────── */

  const handleContentChange = useCallback((val: string) => {
    setContent(val);
    setIsDirty(true);
  }, []);

  const handleModeChange = useCallback(
    (_e: React.SyntheticEvent, newValue: 'edit' | 'preview') => {
      setMode(newValue);
    },
    [],
  );

  const handleToggle = useCallback((checked: boolean) => {
    setEnabled(checked);
    setIsDirty(true);
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (text.length > MAX_CHARS) {
        console.warn(t('entities.projectContext.content.fileTooLarge', 'File content exceeds 2500 characters'));
        return;
      }
      setContent(text);
      setIsDirty(true);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      await saveMutation.mutateAsync({ content, enabled });
      setIsDirty(false);
    } catch {
      console.error(t('entities.projectContext.content.saveFailed', 'Failed to save Project Context'));
    } finally {
      setIsSaving(false);
    }
  }, [content, enabled, saveMutation]);

  const handleDiscard = useCallback(() => {
    if (!isProjectContext || serverData === undefined) return;
    setContent(serverData.content ?? '');
    setEnabled(serverData.enabled ?? true);
    setIsDirty(false);
  }, [isProjectContext, serverData]);

  const handleAIGenerated = useCallback((generatedContent: string) => {
    setContent(generatedContent);
    setIsDirty(true);
  }, []);

  const handleEditorBlur = useCallback((e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsEditorFocused(false);
    }
  }, []);

  /* ── loading state ──────────────────────────────────────────────── */

  const s = projectContextStyles;

  if (isLoading) {
    return (
      <Box sx={s.loader}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  /* ── render ─────────────────────────────────────────────────────── */

  return (
    <Box sx={s.root}>
      <DrawerPage>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '1rem 1.5rem',
            borderBottom: '1px solid #292e42',
          }}
        >
          <Typography variant="headingSmall" color="text.secondary">
            {t('entities.projectContext.content.title', 'Project Context')}
          </Typography>
        </Box>

        <Box sx={s.body}>
          <ProjectParamsHeader projectId={projectId} projectName={projectName} />

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
              canEdit={true}
              onContentChange={handleContentChange}
              onModeChange={handleModeChange}
              onFocus={() => setIsEditorFocused(true)}
              onBlur={handleEditorBlur}
              onAIGenerated={handleAIGenerated}
            />
          )}

          <Box sx={s.actions}>
            <BaseBtn variant="contained" color="primary" disabled={!isDirty || isSaving} onClick={() => void handleSave()}>
              {t('entities.projectContext.content.save', 'Save')}
            </BaseBtn>
            <BaseBtn variant="secondary" color="secondary" disabled={!isDirty} onClick={() => void handleDiscard()}>
              {t('entities.projectContext.content.discard', 'Discard')}
            </BaseBtn>
          </Box>
        </Box>
      </DrawerPage>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,text/markdown"
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />
    </Box>
  );
}
