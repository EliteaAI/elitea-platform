import { useCallback, useState, type ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from '@tanstack/react-router';
import { FormProvider, useForm } from 'react-hook-form';

import {
  applicationCreationSchema,
  CreateApplicationTabBar,
  useCreateApplicationDraft,
  useCreateApplicationInitialValues,
  type ApplicationCreationInput,
} from '@/entities/application-form';
import { t } from '@/shared/i18n';

import { useSelectedProjectId } from './lib/useSelectedProjectId';

const pageSx: SxProps<Theme> = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

const tabBarSx: SxProps<Theme> = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: 1,
  borderColor: 'divider',
  padding: '0 1.5rem',
  minHeight: '3rem',
};

const contentSx: SxProps<Theme> = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '1.5rem',
};

/**
 * Ported from `apps/elitea-ui/src/pages/Pipelines/CreatePipeline.jsx` —
 * ROUTE-018 `/pipelines/create` (spec §8.1). Structurally the
 * pipelines-domain mirror of `pages/agents/CreateApplication.tsx` (Wave-2
 * unit A1g) — a Pipeline literally IS an Application row
 * (`agent_type: 'pipeline'`) — differing only in `useCreateApplicationInitialValues(true)`
 * (forPipeline) and the `/pipelines/*` route targets.
 *
 * **Disclosed Formik->RHF redesign**, same reasoning `pages/agents/
 * CreateApplication.tsx` and the split `entities/application-form`
 * components already establish: the baseline wraps everything in a `Formik`
 * whose `onSubmit` is a no-op — the real "create" call lives inside
 * `CreateAgentForm`'s own `useFormikContext()`/`useCreateApplication(formik)`
 * reads (`entityType="pipeline"`, `CreatePipeline.jsx:78-83`). This page owns
 * a `useForm` + `FormProvider` instance instead.
 *
 * **Dropped, disclosed:** the baseline's `useEffect` dispatching
 * `actions.initThePipeline({nodes: [], edges: [], yamlJsonObject: {state:
 * FlowEditorConstants.DefaultState}, yamlCode: '', layout_version:
 * FlowEditorConstants.LAYOUT_VERSION})` and `editorActions.
 * resetPipelineEditor()` (`CreatePipeline.jsx:20-33`) resets the Redux
 * pipeline-editor slices before the create form mounts. Its zustand
 * equivalent, `features/pipelines/model/pipelineEditorStore.ts`'s
 * `resetPipelineEditor()`, is not exported from `features/pipelines/
 * index.ts` as of this unit's landing (verified — same gap `useSavePipeline.ts`,
 * this unit, cites in full), so there is no R-L3-legal way to call it from
 * `pages/pipelines`. `useCreateApplicationInitialValues(true)`
 * (`entities/application-form`) already seeds an empty
 * `pipelineSettings: {nodes: [], edges: []}` draft independent of that
 * store, so the create FORM's own initial state is not affected by this
 * gap — only a currently-mounted flow-editor widget's own state (owned by a
 * sibling A2 sub-unit) would be.
 *
 * **Composition gap, disclosed:** the baseline's actual field content
 * (`CreateAgentForm`, `@/[fsd]/features/agent/ui/agent-details/
 * configurations/form/CreateAgentForm.jsx`, shared verbatim between the
 * agents and pipelines create pages via `entityType`) is owned by a sibling
 * `agents`-domain Wave-2 sub-unit — `src/features/agents/` has no `ui/`
 * directory or public `index.ts` export for it as of this unit landing
 * (verified directly), and even once it lands, `features/pipelines` may not
 * import `features/agents` (`no-sideways-features`) — so this page cannot
 * legally compose it regardless of landing order. The `FormProvider` this
 * page sets up is exactly the seam a pipelines-domain form panel would need
 * (a `useFormContext()` read) once one exists.
 */
export function CreatePipeline(): ReactNode {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { tab?: string };
  const projectId = useSelectedProjectId();
  const draftDefaults = useCreateApplicationInitialValues(true);
  const { create, isCreating } = useCreateApplicationDraft(projectId);
  const [createError, setCreateError] = useState<unknown>(undefined);

  const form = useForm<ApplicationCreationInput>({
    resolver: zodResolver(applicationCreationSchema),
    mode: 'onChange',
    defaultValues: {
      name: draftDefaults.name,
      description: draftDefaults.description,
      version_details: { conversation_starters: [...draftDefaults.versionDetails.conversationStarters] },
    },
  });

  const handleSave = useCallback(() => {
    void form.handleSubmit(async (values) => {
      setCreateError(undefined);
      const created = await create({
        name: values.name,
        description: values.description,
        type: draftDefaults.type,
        version: {
          ...draftDefaults.versionDetails,
          conversationStarters: (values.version_details?.conversation_starters ?? []).filter(
            (entry): entry is string => typeof entry === 'string',
          ),
        },
      });
      if (created === undefined) {
        setCreateError(new Error('createFailed'));
        return;
      }
      void navigate({
        to: '/pipelines/$tab/$agentId',
        params: { tab: params.tab ?? 'latest', agentId: created.id },
        search: { isFromCreation: 'true' },
      });
    })();
  }, [form, create, draftDefaults, navigate, params.tab]);

  const handleCancel = useCallback(() => {
    void navigate({ to: '/pipelines/$tab', params: { tab: params.tab ?? 'latest' } });
  }, [navigate, params.tab]);

  return (
    <FormProvider {...form}>
      <Box sx={pageSx}>
        <Box sx={tabBarSx}>
          <Typography variant="headingSmall">{t('pages.pipelines.createPipeline.title', 'New Pipeline')}</Typography>
          <CreateApplicationTabBar
            onSave={handleSave}
            onCancel={handleCancel}
            canSave={form.formState.isValid && !isCreating}
            isSaving={isCreating}
            saveTestId="pipeline-save-button"
          />
        </Box>
        <Box sx={contentSx}>
          {createError !== undefined && (
            <Typography
              role="alert"
              variant="bodyMedium"
            >
              {t('pages.pipelines.createPipeline.error', 'Failed to create the pipeline.')}
            </Typography>
          )}
          {/* Composition gap: the shared agents/pipelines CreateAgentForm has not landed as a features/agents public export — see doc comment above. */}
          <Box data-testid="create-pipeline-form-panel" />
        </Box>
      </Box>
    </FormProvider>
  );
}
