import { useCallback, useMemo, useState } from 'react';

import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useWatch, type Control } from 'react-hook-form';

import type { ApplicationCreationInput } from '@/entities/application-form';
import type { PipelineGraphDraft } from '@/features/pipelines';
import { getGetApplicationQueryKey } from '@/shared/api/generated/applications/applications';
import { t } from '@/shared/i18n';
import type { AgentLlmSettings } from '@/shared/api/agentLlmSettings';
import type {
  ApplicationVersionDetail,
  ApplicationVersionSummary,
  VersionWriteRequest,
} from '@/shared/api/generated/model';

import { carryPipelineGraphToVersion } from './carryPipelineGraphToVersion';
import { toNewPipelineVersionBody, toVersionOptions, type EditPipelineVersionOption } from './editPipelineMappers';

export interface PipelineVersionControlsArgs {
  readonly projectId: string | undefined;
  readonly applicationId: number | undefined;
  readonly tab: string | undefined;
  readonly versions: readonly ApplicationVersionSummary[];
  readonly activeVersion: ApplicationVersionDetail | undefined;
  /**
   * The page's RHF control. Conversation starters are read LIVE off it
   * (`useWatch`) rather than off `activeVersion`, for the reason
   * `pages/agents/lib/useEditApplicationVersionControls.ts` states for its
   * twin: a save-as-version clones the CURRENTLY EDITED version, so starters
   * typed but not yet saved must travel with it.
   */
  readonly control: Control<ApplicationCreationInput>;
  /** The live model pick (`useEditPipelineLlmSettings`), which wins over the stored blob. */
  readonly llmSettings: AgentLlmSettings | undefined;
  /** `usePipelineGraphDraft`'s reader — called at click time, never during render. */
  readonly readGraphDraft: () => PipelineGraphDraft | undefined;
  /** Public-project viewer: the selector stays, the write affordances go (`ApplicationTabBar.jsx:65`). */
  readonly isReadOnly: boolean;
  /** While the detail is in flight there is neither a version list nor an active version to show. */
  readonly isFetching: boolean;
}

export interface PipelineVersionControlsState {
  readonly showVersionControls: boolean;
  /** The pipeline id in the string form `SaveNewVersionButton` takes. `''` only while `showVersionControls` is `false`. */
  readonly applicationIdText: string;
  readonly versionOptions: readonly EditPipelineVersionOption[];
  readonly activeVersionId: number | undefined;
  readonly versionBody: Omit<VersionWriteRequest, 'name'>;
  readonly canSaveNewVersion: boolean;
  readonly handleSelectVersion: (version: EditPipelineVersionOption) => void;
  readonly handleNewVersionSaved: (created: ApplicationVersionDetail) => void;
  readonly versionDelete:
    | { readonly applicationVersionId: number | undefined; readonly versionName: string; readonly onVersionDeleted: () => void }
    | undefined;
  /** The most recent version-write failure, already resolved to a message; `undefined` once a later attempt succeeds. */
  readonly versionError: string | undefined;
  readonly reportVersionError: (message: string) => void;
}

/** `conversation_starters` is a loose array on the form input; the write body takes `string[]`. */
function isString(entry: unknown): entry is string {
  return typeof entry === 'string';
}

/** Stable empty body for the window before the active version resolves — a fresh literal each render would make `versionBody` a new prop reference every time. */
const EMPTY_VERSION_BODY: Omit<VersionWriteRequest, 'name'> = {};

/**
 * The page-side half of the pipeline editor's version bar: everything
 * `features/agents`' deliberately-dumb `AgentVersionControls` refuses to own
 * — which route a version switch navigates to, what body a "Save As Version"
 * clones, and what happens once one exists.
 *
 * **The version bar itself is REUSED, not re-implemented.** A Pipeline is an
 * Application row, its versions are `application_versions` rows, and every
 * route the bar drives (`POST /versions/...`, `PATCH /default_version/...`,
 * `DELETE /version/...`) is application-scoped and already generated. The
 * component `pages/agents/EditApplication.tsx` mounts is the same one this
 * page mounts, down to the "Set as default" item and its dialog; the
 * selector is even named `AgentPipelineVersionSelector` because the baseline
 * shared it across both domains. `pages/` -> `features/agents` via that
 * slice's `index.ts` is a downward, barrel-entered edge — the layer gate
 * permits it, and the alternative (a parallel pipelines copy) is how two
 * definitions of "which versions may be pinned" start drifting.
 *
 * **Version switching is a NAVIGATION.** `/pipelines/:tab/:agentId/:version`
 * already exists (ROUTE-069) and `useEditPipelineData` re-fetches the explicit
 * version whenever that param differs from the detail's default — so
 * navigating IS the switch, with no cache surgery and no second source of
 * truth for "which version am I on". `usePipelineVersionSync` then re-seeds
 * the flow editor from the newly-active version's `instructions`, which is
 * what makes the selector actually load a chosen version's GRAPH rather than
 * just relabel the header.
 *
 * **After a new version is created** two things happen that the agents twin
 * does not need. The application-detail response (the dropdown's source) is
 * stale by exactly one entry, so it is invalidated — same as agents. And the
 * live graph is carried onto the new version with a follow-up PUT, because
 * the create endpoint physically cannot store it; see
 * `carryPipelineGraphToVersion.ts` for the two handlers that were read to
 * establish that. The navigation happens LAST, after both, so the editor
 * re-seeds from a version that already holds the graph instead of flashing
 * the pre-carry one.
 */
export function usePipelineVersionControls(args: PipelineVersionControlsArgs): PipelineVersionControlsState {
  const { projectId, applicationId, tab, versions, activeVersion } = args;
  const { control, llmSettings, readGraphDraft, isReadOnly, isFetching } = args;

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [versionError, setVersionError] = useState<string | undefined>(undefined);

  const versionOptions = useMemo(() => toVersionOptions(versions), [versions]);

  const watchedStarters = useWatch({ control, name: 'version_details.conversation_starters' });

  const versionBody = useMemo(() => {
    if (activeVersion === undefined) return EMPTY_VERSION_BODY;
    return toNewPipelineVersionBody(activeVersion, (watchedStarters ?? []).filter(isString), llmSettings);
  }, [activeVersion, watchedStarters, llmSettings]);

  const goToVersion = useCallback(
    (versionId: number) => {
      if (applicationId === undefined) return;
      void navigate({
        to: '/pipelines/$tab/$agentId/$version',
        params: { tab: tab ?? 'latest', agentId: String(applicationId), version: String(versionId) },
      });
    },
    [navigate, applicationId, tab],
  );

  const invalidateDetail = useCallback(() => {
    if (projectId === undefined || applicationId === undefined) return;
    void queryClient.invalidateQueries({ queryKey: getGetApplicationQueryKey(projectId, applicationId) });
  }, [queryClient, projectId, applicationId]);

  const finishNewVersion = useCallback(
    async (created: ApplicationVersionDetail): Promise<void> => {
      const graph = readGraphDraft();
      const createdId = Number(created.id);
      if (graph !== undefined && projectId !== undefined && applicationId !== undefined && !Number.isNaN(createdId)) {
        try {
          await carryPipelineGraphToVersion(queryClient, {
            projectId,
            applicationId,
            versionId: createdId,
            graph,
          });
          setVersionError(undefined);
        } catch {
          // The version EXISTS — it just holds the previously stored graph.
          // Reported rather than swallowed, and the navigation below still
          // happens so the user lands on the version they just made.
          setVersionError(
            t(
              'pages.pipelines.editPipeline.versionGraphCarryError',
              'The new version was created, but its flow graph could not be copied onto it.',
            ),
          );
        }
      }
      invalidateDetail();
      goToVersion(createdId);
    },
    [readGraphDraft, projectId, applicationId, queryClient, invalidateDetail, goToVersion],
  );

  const handleNewVersionSaved = useCallback(
    (created: ApplicationVersionDetail) => {
      void finishNewVersion(created);
    },
    [finishNewVersion],
  );

  /*
   * After the open version is deleted the URL still points at it and
   * `useEditPipelineData` would 404 on the next fetch. Navigate to the
   * pipeline's version-less route (its default version) and invalidate the
   * detail, whose `versions[]` is stale by exactly the deleted entry — the
   * mirror image of `finishNewVersion` above.
   */
  const handleVersionDeleted = useCallback(() => {
    invalidateDetail();
    if (applicationId === undefined) return;
    void navigate({
      to: '/pipelines/$tab/$agentId',
      params: { tab: tab ?? 'latest', agentId: String(applicationId) },
    });
  }, [invalidateDetail, navigate, applicationId, tab]);

  const versionDelete = useMemo(() => {
    if (activeVersion === undefined) return undefined;
    return {
      applicationVersionId: Number(activeVersion.id),
      versionName: activeVersion.name,
      onVersionDeleted: handleVersionDeleted,
    };
  }, [activeVersion, handleVersionDeleted]);

  const handleSelectVersion = useCallback(
    (version: EditPipelineVersionOption) => goToVersion(version.id),
    [goToVersion],
  );

  return {
    showVersionControls: !isFetching && applicationId !== undefined,
    applicationIdText: applicationId === undefined ? '' : String(applicationId),
    versionOptions,
    activeVersionId: activeVersion === undefined ? undefined : Number(activeVersion.id),
    versionBody,
    canSaveNewVersion: !isReadOnly && activeVersion !== undefined,
    handleSelectVersion,
    handleNewVersionSaved,
    versionDelete,
    versionError,
    reportVersionError: setVersionError,
  };
}
