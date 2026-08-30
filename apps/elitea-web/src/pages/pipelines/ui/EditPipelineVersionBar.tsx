import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useFormContext } from 'react-hook-form';

import type { ApplicationCreationInput } from '@/entities/application-form';
import { AgentVersionControls } from '@/features/agents';
import { usePipelineGraphDraft } from '@/features/pipelines';
import type { AgentLlmSettings } from '@/shared/api/agentLlmSettings';
import type { ApplicationVersionDetail, ApplicationVersionSummary } from '@/shared/api/generated/model';

import { usePipelineVersionControls } from '../lib/usePipelineVersionControls';

const wrapperSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: '0.75rem' };

export interface EditPipelineVersionBarProps {
  readonly projectId: string | undefined;
  readonly applicationId: number | undefined;
  readonly tab: string | undefined;
  readonly versions: readonly ApplicationVersionSummary[];
  readonly activeVersion: ApplicationVersionDetail | undefined;
  /** Public-project viewer — the selector stays, the write affordances go. */
  readonly isReadOnly: boolean;
  readonly isFetching: boolean;
  /** The live model pick, which a cloned version inherits over the stored blob. */
  readonly llmSettings: AgentLlmSettings | undefined;
}

/**
 * The pipeline editor's version bar — the pipelines-side mount point for
 * `features/agents`' `AgentVersionControls` (version dropdown + Set-as-default
 * + Delete version + Save As Version).
 *
 * **Why a component rather than inline JSX in `EditPipeline.tsx`.** Two
 * reasons, both structural. `useFormContext` and `usePipelineGraphDraft` are
 * read here so the page does not have to thread a `control` and a graph
 * reader through props: `EditPipeline` both CREATES the RHF instance and
 * renders `<FormProvider>`, so it sits above its own provider and cannot call
 * a context hook itself — the same constraint `EditPipelineSaveBar.tsx`
 * already documents for `useDiscardPipelineChanges`. And the page is at the
 * §3.5 400-line ceiling; every decision this file makes would otherwise have
 * to be made there.
 *
 * The error line covers BOTH version-write failures — the create POST's (via
 * `onNewVersionError`) and the follow-up graph PUT's — because this app has
 * no toast infrastructure and the page's own `role="alert"` banner sits in
 * the content area, below the fold of the bar the user just clicked in.
 */
export function EditPipelineVersionBar({
  projectId,
  applicationId,
  tab,
  versions,
  activeVersion,
  isReadOnly,
  isFetching,
  llmSettings,
}: EditPipelineVersionBarProps): ReactNode {
  const { control } = useFormContext<ApplicationCreationInput>();
  const readGraphDraft = usePipelineGraphDraft();

  const controls = usePipelineVersionControls({
    projectId,
    applicationId,
    tab,
    versions,
    activeVersion,
    control,
    llmSettings,
    readGraphDraft,
    isReadOnly,
    isFetching,
  });

  if (!controls.showVersionControls) return null;

  return (
    <Box sx={wrapperSx}>
      {controls.versionError !== undefined && (
        <Typography
          role="alert"
          variant="bodySmall"
        >
          {controls.versionError}
        </Typography>
      )}
      <AgentVersionControls
        applicationId={controls.applicationIdText}
        projectId={projectId}
        versions={controls.versionOptions}
        activeVersionId={controls.activeVersionId}
        onSelectVersion={controls.handleSelectVersion}
        versionBody={controls.versionBody}
        canSaveNewVersion={controls.canSaveNewVersion}
        versionDelete={controls.versionDelete}
        onNewVersionSaved={controls.handleNewVersionSaved}
        onNewVersionError={controls.reportVersionError}
      />
    </Box>
  );
}
