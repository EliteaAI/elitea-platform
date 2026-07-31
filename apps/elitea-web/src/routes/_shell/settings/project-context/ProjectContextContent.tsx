/**
 * ProjectContextContent — main content area for the Project Context settings
 * tab (Settings > Project Params > Project Context).
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/project-context/ProjectContextContent.jsx`.
 *
 * Uses:
 *  - Generated `useGetProjectContext` for context retrieval
 *  - Raw `updateProjectContext` (PUT) via `useMutation` for context updates
 *  - `useUpdateProjectInfo` mutation for icon persistence
 *  - `GenerateProjectContextButton` for AI-generated drafts
 *  - `EnableToggleCard` (extracted) for the enable/disable toggle
 *  - `ProjectParamsHeader` for the project avatar + info row
 *  - `CodeMirrorEditor` for editing (no markdown extension — not installed)
 *  - `Markdown` for preview mode
 *  - `t()` for all text
 *
 * Permissions (spec §9.3): `PERMISSIONS.projectContext.view` gates the
 * entire page; `PERMISSIONS.projectContext.edit` gates save/discard/generate
 * buttons. Without `view`, the user sees a "No access" message.
 */
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { BannerMessage } from '@/shared/ui/BannerMessage';
import { DrawerPage } from '@/routes/_shell/settings/DrawerPage';
import { ProjectContextBody, ProjectContextToasts } from './ProjectContextBody';
import { t } from '@/shared/i18n';
import {
  updateProjectContext,
  useGetProjectContext,
} from '@/shared/api/generated/applications/applications';
import {
  updateProjectInfo,
} from '@/entities/project/api/projectContextApi';
import { projectContextStyles } from './ProjectContextContent.styles';
import { useCallback, useEffect, useRef, useState } from 'react';

/* ── constants ─────────────────────────────────────────────────────────── */

const MAX_CHARS = 2500;

/* ── helper: derive show conditions ───────────────────────────────────── */

interface ProjectContextShowFlags {
  readonly showReadOnlyBanner: boolean;
  readonly showDisabledBanner: boolean;
  readonly showEditorContent: boolean;
  readonly showEditorControls: boolean;
}

function deriveShowFlags(canEdit: boolean, enabled: boolean, content: string): ProjectContextShowFlags {
  return {
    showReadOnlyBanner: !canEdit,
    showDisabledBanner: !enabled && Boolean(content.trim()),
    showEditorContent: enabled || Boolean(content.trim()),
    showEditorControls: enabled && canEdit,
  };
}

/* ── props ─────────────────────────────────────────────────────────────── */

export interface ProjectContextContentProps {
  projectId: string;
  projectName: string;
  /** Whether the user has `view` permission for project context. */
  canView?: boolean;
  /** Whether the user has `edit` permission for project context. */
  canEdit?: boolean;
}

/* ── component ─────────────────────────────────────────────────────────── */

export function ProjectContextContent({
  projectId,
  projectName,
  canView = true,
  canEdit = true,
}: ProjectContextContentProps) {
  /* ── hooks (must come before any early return) ───────────────────── */

  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  /* ── project context query ──────────────────────────────────────── */

  const { data: ctxResponse, isLoading } = useGetProjectContext(projectId, {
    query: { enabled: !!projectId && canView },
  });

  /* ── mutations ──────────────────────────────────────────────────── */

  const saveMutation = useMutation({
    mutationFn: ({ content, enabled }: { content: string; enabled: boolean }) =>
      updateProjectContext(projectId, { content, enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [`/elitea_core/project_context/prompt_lib/${projectId}/project-context`] });
    },
  } as { mutateAsync: (args: { content: string; enabled: boolean }) => Promise<unknown> });

  /* ── local state ────────────────────────────────────────────────── */

  const [isSaving, setIsSaving] = useState(false);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [showSaveToast, setShowSaveToast] = useState(false);
  const [showErrorToast, setShowErrorToast] = useState(false);
  const [content, setContent] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [isDirty, setIsDirty] = useState(false);

  /* ── server data ────────────────────────────────────────────────── */

  const serverData = ctxResponse?.data;
  const isProjectContext =
    serverData && typeof serverData === 'object' && 'content' in serverData;

  useEffect(() => {
    if (isProjectContext && serverData !== undefined) {
      setContent(serverData.content ?? '');
      setEnabled(serverData.enabled ?? true);
      setIsDirty(false);
    }
  }, [isProjectContext, serverData]);

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
      const result = (ev.target?.result as string) ?? '';
      const text = String(result).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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
      setShowSaveToast(true);
    } catch {
      setShowErrorToast(true);
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
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsEditorFocused(false);
    }
  }, []);

  const handleIconChange = useCallback(async (iconName: string | null) => {
    try {
      await updateProjectInfo(projectId, iconName ? { name: iconName } : null);
    } catch {
      // Icon persistence error — not fatal, but worth noting
      console.error(t('entities.projectContext.content.iconSaveFailed', 'Failed to save icon'));
    }
  }, [projectId]);

  const handleCloseErrorToast = useCallback(() => setShowErrorToast(false), []);
  const handleCloseSaveToast = useCallback(() => setShowSaveToast(false), []);

  /* ── permissions early return ───────────────────────────────────── */

  if (!canView) {
    return (
      <Box sx={projectContextStyles.root}>
        <DrawerPage>
          <BannerMessage
            message={t('entities.projectContext.content.noAccess', 'You do not have permission to view this setting.')}
            variant="info"
          />
        </DrawerPage>
      </Box>
    );
  }

  /* ── derived state ──────────────────────────────────────────────── */

  const showFlags = deriveShowFlags(canEdit, enabled, content);
  const { showReadOnlyBanner, showDisabledBanner, showEditorContent, showEditorControls } = showFlags;

  /* ── loading state ──────────────────────────────────────────────── */

  const s = projectContextStyles;

  if (isLoading) {
    return (
      <Box sx={s.loader}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  return (
    <>
      <ProjectContextBody
        projectId={projectId}
        projectName={projectName}
        enabled={enabled}
        showReadOnlyBanner={showReadOnlyBanner}
        showDisabledBanner={showDisabledBanner}
        showEditorContent={showEditorContent}
        content={content}
        mode={mode}
        isEditorFocused={isEditorFocused}
        showEditorControls={showEditorControls}
        canEdit={canEdit}
        isDirty={isDirty}
        isSaving={isSaving}
        handleToggle={handleToggle}
        handleContentChange={handleContentChange}
        handleModeChange={handleModeChange}
        handleEditorBlur={handleEditorBlur}
        handleAIGenerated={handleAIGenerated}
        handleIconChange={handleIconChange}
        handleSave={handleSave}
        handleDiscard={handleDiscard}
        onFocus={() => setIsEditorFocused(true)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,text/markdown"
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />
      <ProjectContextToasts
        showSaveToast={showSaveToast}
        showErrorToast={showErrorToast}
        onCloseSave={handleCloseSaveToast}
        onCloseError={handleCloseErrorToast}
      />
    </>
  );
}
