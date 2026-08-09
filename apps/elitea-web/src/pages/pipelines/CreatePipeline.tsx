import { useCallback, useRef, useState, type ReactNode } from 'react';

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
import { CreateAgentForm } from '@/features/agents';
import { t } from '@/shared/i18n';
import { disarmUnsavedChangesNavBlocker, useUnsavedChangesNavBlocker } from '@/widgets/app-shell';

import { useSelectedProjectId } from './lib/useSelectedProjectId';

/**
 * The `version_details` subset `CreateAgentForm` reads/writes that
 * `applicationCreationSchema` (name/description/conversation_starters only)
 * does not validate — held as local state rather than widening the RHF form's
 * generic. Same adapter, same reasoning as
 * `pages/agents/CreateApplication.tsx`'s `CreateAgentFormExtraFields`.
 */
interface CreatePipelineFormExtraFields {
  readonly instructions: string;
  readonly welcomeMessage: string;
  readonly variables: { readonly name: string; readonly value: string }[];
  readonly stepLimit: number | undefined;
}

/**
 * The `extraFields` half of "is this draft dirty?" (#133) — RHF's
 * `formState.isDirty` only sees the three schema-validated fields, so a user
 * who typed only instructions would otherwise lose that work unprompted.
 *
 * Duplicated from `pages/agents/CreateApplication.tsx`'s
 * `areExtraFieldsEqual` rather than shared: `entities/application-form`'s
 * barrel — the only slice both pages could legally reach for it — is at its
 * §3.5 export budget (exactly 20, its own header says so), and a
 * `pages/pipelines` -> `pages/agents` import is a sideways page import. The
 * whole surrounding adapter is already deliberately duplicated between these
 * two files for the same reason (see this file's own header).
 */
function areExtraFieldsEqual(a: CreatePipelineFormExtraFields, b: CreatePipelineFormExtraFields): boolean {
  if (a.instructions !== b.instructions) return false;
  if (a.welcomeMessage !== b.welcomeMessage) return false;
  if (a.stepLimit !== b.stepLimit) return false;
  if (a.variables.length !== b.variables.length) return false;
  return a.variables.every((variable, index) => {
    const other = b.variables[index];
    return other !== undefined && variable.name === other.name && variable.value === other.value;
  });
}

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
 * **Composition gap, CLOSED.** This page previously rendered
 * `<Box data-testid="create-pipeline-form-panel" />` — a self-closing, empty
 * element — on the stated grounds that (a) `features/agents` had no public
 * `CreateAgentForm` export, and (b) `no-sideways-features` would forbid the
 * import anyway. Both were stale by the time the E2E suite first ran and
 * failed here (J16: the testid resolved 24× to an empty div, never visible):
 *
 *  - `CreateAgentForm` IS a public export of `features/agents`
 *    (`features/agents/index.ts:32`), and `pages/agents/CreateApplication.tsx`
 *    already imports it.
 *  - `no-sideways-features` is scoped `from: ^src/features/([^/]+)/`
 *    (`.dependency-cruiser.cjs:54`). This file is a PAGE, not a feature, and
 *    `page -> feature` is the ordinary layer direction (§3.2).
 *
 * The adapter below mirrors `pages/agents/CreateApplication.tsx`'s: the RHF
 * form owns name/description (the only fields `applicationCreationSchema`
 * validates) and local state owns the version_details fields the schema does
 * not cover, exactly as the agents page does and for the same reason.
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

  const [extraFields, setExtraFields] = useState<CreatePipelineFormExtraFields>({
    instructions: draftDefaults.versionDetails.instructions,
    welcomeMessage: '',
    variables: draftDefaults.versionDetails.variables.map((variable) => ({ ...variable })),
    stepLimit: draftDefaults.versionDetails.meta.step_limit,
  });

  /*
   * #133 — arm the app-wide unsaved-changes guard, exactly as
   * `pages/agents/CreateApplication.tsx` now does. `widgets/app-shell`'s
   * `NavBlockerDialog` was mounted under this page all along but nothing on
   * the standalone `/pipelines` editors ever raised the flag, so a typed
   * draft was thrown away on any nav-link click. `useRef`'s initialiser is
   * kept only from the first render, so this holds the opening values.
   */
  const initialExtraFields = useRef(extraFields);
  const isDraftDirty = form.formState.isDirty || !areExtraFieldsEqual(extraFields, initialExtraFields.current);
  useUnsavedChangesNavBlocker(isDraftDirty);

  const name = form.watch('name') ?? '';
  const description = form.watch('description') ?? '';

  const pipelineDraftValues = {
    name,
    description,
    version_details: {
      instructions: extraFields.instructions,
      welcome_message: extraFields.welcomeMessage,
      variables: extraFields.variables,
      meta: { step_limit: extraFields.stepLimit },
    },
  };

  const handlePipelineFieldChange = useCallback(
    (path: string, value: unknown) => {
      switch (path) {
        case 'name':
          form.setValue('name', typeof value === 'string' ? value : '', { shouldValidate: true, shouldDirty: true });
          return;
        case 'description':
          form.setValue('description', typeof value === 'string' ? value : '', {
            shouldValidate: true,
            shouldDirty: true,
          });
          return;
        case 'version_details.instructions':
          setExtraFields((previous) => ({ ...previous, instructions: typeof value === 'string' ? value : '' }));
          return;
        case 'version_details.welcome_message':
          setExtraFields((previous) => ({ ...previous, welcomeMessage: typeof value === 'string' ? value : '' }));
          return;
        case 'version_details.variables':
          setExtraFields((previous) => ({
            ...previous,
            variables: Array.isArray(value) ? (value as { name: string; value: string }[]) : previous.variables,
          }));
          return;
        case 'version_details.meta.step_limit':
          setExtraFields((previous) => ({
            ...previous,
            stepLimit: typeof value === 'number' ? value : undefined,
          }));
          return;
        default:
          return;
      }
    },
    [form],
  );

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
      // #133: the draft is persisted — this is the SAVE's own navigation,
      // not a nav-away from unsaved work.
      disarmUnsavedChangesNavBlocker();
      void navigate({
        to: '/pipelines/$tab/$agentId',
        params: { tab: params.tab ?? 'latest', agentId: created.id },
        search: { isFromCreation: 'true' },
      });
    })();
  }, [form, create, draftDefaults, navigate, params.tab]);

  const handleCancel = useCallback(() => {
    // #133: Cancel IS the explicit discard, so it is not also prompted.
    disarmUnsavedChangesNavBlocker();
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
          <Box data-testid="create-pipeline-form-panel">
            <CreateAgentForm
              values={pipelineDraftValues}
              onFieldChange={handlePipelineFieldChange}
              disabled={isCreating}
            />
          </Box>
        </Box>
      </Box>
    </FormProvider>
  );
}
