import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

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
import { EliteaApiError } from '@/shared/api/generated/mutator';
import { t } from '@/shared/i18n';
import { disarmUnsavedChangesNavBlocker, useUnsavedChangesNavBlocker } from '@/widgets/app-shell';

import { useSelectedProjectId } from './lib/useSelectedProjectId';

/**
 * The subset of `AgentDraftValues.version_details` (`features/agents`'
 * internal, unexported type) that `CreateAgentForm` actually reads/writes on
 * a brand-new draft but that `applicationCreationSchema` (this page's RHF
 * validation schema — name/description/`conversation_starters` only) does
 * not cover. Held as separate local state rather than widening the RHF
 * form's generic type: `zodResolver(applicationCreationSchema)` is typed as
 * `Resolver<ApplicationCreationInput>`, and stretching the form's type
 * param to a superset would require an unsound resolver cast for zero real
 * benefit, since none of these fields are ever validated anyway (same as
 * the baseline: its yup schema didn't touch them either). This is the "small
 * adapter" this file's own doc comment below anticipated.
 */
interface CreateAgentFormExtraFields {
  readonly instructions: string;
  readonly welcomeMessage: string;
  readonly variables: { readonly name: string; readonly value: string }[];
  readonly stepLimit: number | undefined;
}

/**
 * The `extraFields` half of "is this draft dirty?" (#133).
 *
 * RHF's `formState.isDirty` only covers the three fields
 * `applicationCreationSchema` validates (`name`, `description`,
 * `version_details.conversation_starters`); the four in
 * `CreateAgentFormExtraFields` are deliberately held OUTSIDE the form (see
 * that interface's own doc comment), so a user who typed only instructions
 * or a welcome message would be invisible to `isDirty` and would lose that
 * work on nav-away. Compared field-by-field against the values this page
 * started from rather than tracked with a sticky "user touched something"
 * boolean, so undoing an edit correctly disarms the guard again.
 */
function areExtraFieldsEqual(a: CreateAgentFormExtraFields, b: CreateAgentFormExtraFields): boolean {
  if (a.instructions !== b.instructions) return false;
  if (a.welcomeMessage !== b.welcomeMessage) return false;
  if (a.stepLimit !== b.stepLimit) return false;
  if (a.variables.length !== b.variables.length) return false;
  return a.variables.every((variable, index) => {
    const other = b.variables[index];
    return other !== undefined && variable.name === other.name && variable.value === other.value;
  });
}

interface CreateApplicationFieldErrors {
  readonly name?: string;
  readonly description?: string;
}

function isFastApiErrorDetail(value: unknown): value is { readonly msg?: unknown; readonly loc?: readonly unknown[] } {
  return typeof value === 'object' && value !== null;
}

/**
 * Maps the create-application endpoint's failure onto per-field messages —
 * old app: `useCreateApplication.jsx:85-107` inspects `error.data` (a
 * FastAPI/Pydantic-style array of `{loc, msg}` entries — same shape
 * `shared/lib/http-error.ts`'s `ErrorDetail`/`messageFromValidationArray`
 * already ports for this exact backend family) and calls
 * `formik.setFieldError('name'|'description', msg)` per entry, so e.g. a
 * duplicate-name rejection is shown attributed to the Name field rather than
 * as one generic message.
 *
 * **Disclosed gap:** `features/agents/ui/CreateAgentForm.tsx` (out of this
 * unit's file scope — owned by sub-unit A1c) takes no `nameError`/
 * `descriptionError`-shaped prop at all (verified: `CreateAgentFormProps`
 * has no such field, and `GeneralFields`' `StyledInputEnhancer` calls pass
 * no `error`/`helperText`), so a mapped field error cannot be rendered
 * literally under the Name/Description inputs from this file alone. This
 * still closes the finding's real complaint — field-attributed text instead
 * of one generic, un-attributed message — via the banner below;
 * true inline-under-field parity needs a follow-up prop on `CreateAgentForm`.
 */
function mapCreateErrorToFieldErrors(error: unknown): CreateApplicationFieldErrors {
  if (!(error instanceof EliteaApiError) || error.failure.kind !== 'http') return {};
  const body: unknown = error.failure.body;
  if (!Array.isArray(body)) return {};
  const fieldErrors: { name?: string; description?: string } = {};
  for (const entry of body) {
    if (!isFastApiErrorDetail(entry) || typeof entry.msg !== 'string') continue;
    const loc = entry.loc ?? [];
    if (loc.includes('name')) fieldErrors.name = entry.msg;
    else if (loc.includes('description')) fieldErrors.description = entry.msg;
  }
  return fieldErrors;
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
 * Ported from `apps/elitea-ui/src/pages/Applications/CreateApplication.jsx`
 * — ROUTE-010 `/agents/create` (spec §8.1).
 *
 * **Disclosed Formik->RHF redesign** (matching the split
 * `entities/application-form`'s own components already establish for this
 * exact page): the baseline wraps everything in a `Formik` whose
 * `onSubmit` is a no-op — the real "create" call and every field's
 * dirty/error state live inside `CreateAgentForm`'s own
 * `useFormikContext()`/`useCreateApplication(formik)` reads. Since Formik
 * is not a dependency of this app (`react-hook-form` is), this page owns a
 * `useForm` + `FormProvider` instance instead — the RHF-native equivalent
 * of "give descendant field components a shared, contextual form" — and
 * wires the promoted `CreateApplicationTabBar`'s `onSave`/`canSave`/
 * `isSaving` explicitly, since that component (unlike the baseline's local
 * `Components/Applications/CreateApplicationTabBar.jsx` it was promoted
 * from) takes no implicit Formik context.
 *
 * **Composition gap — now closed.** The baseline's actual field content
 * (`CreateAgentForm`, `@/[fsd]/features/agent/ui/agent-details/
 * configurations/form/CreateAgentForm.jsx`) is owned by sub-unit A1c, a
 * sibling of this unit under the same `agents` domain sub-partition. At an
 * earlier point in this unit's landing, `src/features/agents/` had no
 * `ui/` directory or public `index.ts` yet, so this page rendered a bare
 * `data-testid="create-application-form-panel"` placeholder `Box` instead.
 * A1c has since landed and exports `CreateAgentForm` from
 * `@/features/agents`'s public API — this page now renders it directly, via
 * the `FormProvider`/`useFormContext()`-free adapter shape it actually
 * needs (see below), not the `useFormikContext()` shape the stale version of
 * this comment assumed A1c would land with.
 *
 * **The FormProvider set up below is now dead / vestigial**, kept only
 * because `CreateApplicationTabBar` (`entities/application-form`) still
 * reads `form.formState.isValid`/`form.handleSubmit` off this same `form`
 * instance for `canSave`/`onSave` — `CreateAgentForm` itself does NOT read
 * ambient form context (see its own doc comment: it takes `values`/
 * `onFieldChange` as plain props, the same "no ambient form-library
 * context" convention `features/agents/model/types.ts`'s module doc
 * establishes for this entire slice). The small adapter below
 * (`agentDraftValues`/`handleAgentFieldChange`) bridges this page's RHF
 * `form` + `extraFields` local state into that plain-props shape:
 *  - `name`/`description` map straight onto the RHF-validated fields.
 *  - `version_details.instructions`/`welcome_message`/`variables`/
 *    `meta.step_limit` are NOT covered by `applicationCreationSchema` (see
 *    that schema's own doc comment: only `name`/`description`/
 *    `conversation_starters` are validated, matching the baseline's yup
 *    schema) and are held in a sibling `extraFields` state slice instead of
 *    widening the RHF form's generic type — see `CreateAgentFormExtraFields`
 *    above for why.
 *  - `conversationStartersSlot`/`iconSlot`/`tagsSlot`/
 *    `generateAgentButtonSlot` are left unset: each is a genuine, separately
 *    disclosed composition gap on `CreateAgentForm`'s OWN doc comment (no
 *    `shared/ui`/other-sub-unit port exists for any of the four yet), not a
 *    gap this page introduces.
 *
 * `applicationCreationSchema` validates the WIRE-shaped
 * `{name, description, version_details.conversation_starters}` object
 * (`entities/application-form/model/validation.ts`'s own doc comment); this
 * page's RHF form state mirrors that exact shape (not
 * `useCreateApplicationInitialValues`'s camelCase `ApplicationDraft`) so the
 * promoted schema can validate it directly, and maps the two (plus
 * `extraFields`) together once, on submit — see `handleSave` below.
 */
export function CreateApplication(): ReactNode {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { tab?: string };
  const projectId = useSelectedProjectId();
  const draftDefaults = useCreateApplicationInitialValues(false);
  const { create, isCreating, error: createDraftError } = useCreateApplicationDraft(projectId);
  // Per-field attribution (e.g. a duplicate-name conflict shown under the
  // Name field) — see `mapCreateErrorToFieldErrors`'s own doc comment for
  // the baseline citation and the disclosed `CreateAgentForm` gap.
  const createFieldErrors = useMemo(() => mapCreateErrorToFieldErrors(createDraftError), [createDraftError]);
  const hasCreateFieldError = createFieldErrors.name !== undefined || createFieldErrors.description !== undefined;

  const form = useForm<ApplicationCreationInput>({
    resolver: zodResolver(applicationCreationSchema),
    mode: 'onChange',
    defaultValues: {
      name: draftDefaults.name,
      description: draftDefaults.description,
      version_details: { conversation_starters: [...draftDefaults.versionDetails.conversationStarters] },
    },
  });

  // See `CreateAgentFormExtraFields`'s own doc comment: the `CreateAgentForm`
  // fields `applicationCreationSchema` does not validate.
  const [extraFields, setExtraFields] = useState<CreateAgentFormExtraFields>({
    instructions: draftDefaults.versionDetails.instructions,
    welcomeMessage: '',
    variables: draftDefaults.versionDetails.variables.map((variable) => ({ ...variable })),
    stepLimit: draftDefaults.versionDetails.meta.step_limit,
  });

  /*
   * #133 — arm the app-wide unsaved-changes guard. `widgets/app-shell`'s
   * `NavBlockerDialog` + its TanStack `useBlocker` have always been mounted
   * under this page; nothing on the standalone `/agents` editors ever raised
   * the flag, so typing a name here and clicking any nav link navigated
   * through silently and threw the draft away. `useRef`'s initialiser is
   * only kept from the first render, so this holds the values the page
   * opened with. Guard is disarmed on unmount by the hook itself.
   */
  const initialExtraFields = useRef(extraFields);
  const isDraftDirty = form.formState.isDirty || !areExtraFieldsEqual(extraFields, initialExtraFields.current);
  useUnsavedChangesNavBlocker(isDraftDirty);

  const name = form.watch('name') ?? '';
  const description = form.watch('description') ?? '';

  // The small adapter this file's doc comment describes: bridges RHF `form`
  // + `extraFields` into `CreateAgentForm`'s plain `values`/`onFieldChange`
  // prop shape (no ambient form context — see that component's own doc
  // comment).
  const agentDraftValues = {
    name,
    description,
    version_details: {
      instructions: extraFields.instructions,
      welcome_message: extraFields.welcomeMessage,
      variables: extraFields.variables,
      meta: { step_limit: extraFields.stepLimit },
    },
  };

  const handleAgentFieldChange = useCallback(
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
      const created = await create({
        name: values.name,
        description: values.description,
        type: draftDefaults.type,
        version: {
          ...draftDefaults.versionDetails,
          instructions: extraFields.instructions,
          conversationStarters: (values.version_details?.conversation_starters ?? []).filter(
            (entry): entry is string => typeof entry === 'string',
          ),
          variables: extraFields.variables,
          meta: { ...draftDefaults.versionDetails.meta, step_limit: extraFields.stepLimit ?? draftDefaults.versionDetails.meta.step_limit },
        },
      });
      // On failure, `create`'s own `error` state (destructured above as
      // `createDraftError`) carries the real failure — rendered below,
      // field-attributed where possible. Nothing further to do here.
      if (created === undefined) return;
      // #133: the draft is persisted — this navigation is the SAVE's own,
      // not a nav-away from unsaved work, so it must not be prompted about.
      disarmUnsavedChangesNavBlocker();
      void navigate({
        to: '/agents/$tab/$agentId',
        params: { tab: params.tab ?? 'latest', agentId: created.id },
        search: { isFromCreation: 'true' },
      });
    })();
  }, [form, create, draftDefaults, extraFields, navigate, params.tab]);

  const handleCancel = useCallback(() => {
    // #133: Cancel IS the explicit "throw this draft away" action, so it
    // does not also get the unsaved-changes prompt — same as the
    // chat-embedded editors, which lower the flag when their editor closes.
    disarmUnsavedChangesNavBlocker();
    void navigate({ to: '/agents/$tab', params: { tab: params.tab ?? 'latest' } });
  }, [navigate, params.tab]);

  return (
    <FormProvider {...form}>
      <Box sx={pageSx}>
        <Box sx={tabBarSx}>
          <Typography variant="headingSmall">{t('pages.agents.createApplication.title', 'New Agent')}</Typography>
          <CreateApplicationTabBar
            onSave={handleSave}
            onCancel={handleCancel}
            canSave={form.formState.isValid && !isCreating}
            isSaving={isCreating}
          />
        </Box>
        <Box sx={contentSx}>
          {createDraftError !== undefined && (
            <Box role="alert">
              {createFieldErrors.name !== undefined && (
                <Typography variant="bodyMedium">
                  {t('pages.agents.createApplication.fieldError.name', 'Name: {{message}}', {
                    message: createFieldErrors.name,
                  })}
                </Typography>
              )}
              {createFieldErrors.description !== undefined && (
                <Typography variant="bodyMedium">
                  {t('pages.agents.createApplication.fieldError.description', 'Description: {{message}}', {
                    message: createFieldErrors.description,
                  })}
                </Typography>
              )}
              {!hasCreateFieldError && (
                <Typography variant="bodyMedium">
                  {t('pages.agents.createApplication.error', 'Failed to create the agent.')}
                </Typography>
              )}
            </Box>
          )}
          <CreateAgentForm
            values={agentDraftValues}
            onFieldChange={handleAgentFieldChange}
            disabled={isCreating}
          />
        </Box>
      </Box>
    </FormProvider>
  );
}
