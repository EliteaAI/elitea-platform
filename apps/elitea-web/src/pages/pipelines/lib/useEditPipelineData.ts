import { useGetApplication, useGetApplicationVersionDetail } from '@/shared/api/generated/applications/applications';
import { EliteaApiError } from '@/shared/api/generated/mutator';
import type { ApplicationDetail, ApplicationVersionDetail, ApplicationVersionSummary } from '@/shared/api/generated/model';

/** Stable empty array — `detail?.versions ?? []` would otherwise create a fresh array reference every render (`react-hooks/exhaustive-deps`: a `useMemo` depending on it would never actually memoize). */
const EMPTY_VERSIONS: readonly ApplicationVersionSummary[] = [];

export interface EditPipelineData {
  readonly detail: ApplicationDetail | undefined;
  readonly versions: readonly ApplicationVersionSummary[];
  readonly activeVersion: ApplicationVersionDetail | undefined;
  readonly isFetching: boolean;
  readonly isError: boolean;
  /**
   * `true` when the application-DETAIL fetch itself (not the optional
   * explicit-version fetch) failed with a 404 or 400 — old app:
   * `isNotFoundError` (`common/utils.jsx:143`,
   * `err?.status === 404 || err?.status === 400`), read by
   * `EditPipeline.jsx`'s `shouldShowNotFoundPage = (isError &&
   * isNotFoundError(error)) || isVersionNotFound`. Reproduced verbatim from
   * `pages/agents/lib/useEditApplicationData.ts`'s own `isDetailNotFound`
   * (Wave-2 unit A1g) — a Pipeline literally IS an Application row, so the
   * same `EliteaApiError`/`error.failure.kind === 'http'` duck-typed check
   * applies unchanged. Adversarial-review fix: a 404/400 detail fetch
   * previously fell through to the normal edit shell with only an inline
   * error banner, leaving the Save/Cancel tab bar and an empty
   * configuration panel visible for a deleted/invalid pipeline id.
   */
  readonly isDetailNotFound: boolean;
}

/** Split out purely to keep `useEditPipelineData`'s own branch count under the oxlint complexity budget — see `EditPipelineData.isDetailNotFound`'s own doc comment for the full citation trail. */
function isNotFoundApiError(error: unknown): boolean {
  if (!(error instanceof EliteaApiError) || error.failure.kind !== 'http') return false;
  return error.failure.status === 404 || error.failure.status === 400;
}

/** Split out purely to keep `useEditPipelineData`'s own branch count under the oxlint complexity budget. */
function needsExplicitVersionFetch(requestedVersionId: string | undefined, currentVersionId: string | undefined): boolean {
  return requestedVersionId !== undefined && requestedVersionId !== currentVersionId;
}

/** Split out purely to keep `useEditPipelineData`'s own branch count under the oxlint complexity budget. */
function isVersionQueryEnabled(
  needsExplicit: boolean,
  projectId: string | undefined,
  applicationId: number | undefined,
  explicitVersionId: number,
): boolean {
  if (!needsExplicit) return false;
  if (projectId === undefined || applicationId === undefined) return false;
  return !Number.isNaN(explicitVersionId);
}

/** Split out purely to keep `useEditPipelineData`'s own branch count under the oxlint complexity budget — `isFetching`/`isError` are both this same "primary query's flag, OR the secondary query's flag when it's actually in play" shape. */
function combineQueryFlag(primary: boolean, needsExplicit: boolean, secondary: boolean): boolean {
  if (primary) return true;
  return needsExplicit && secondary;
}

/** Split out purely to keep `useEditPipelineData`'s own branch count under the oxlint complexity budget. */
function isDetailQueryEnabled(projectId: string | undefined, applicationId: number | undefined): boolean {
  return projectId !== undefined && applicationId !== undefined;
}

/** Split out purely to keep `useEditPipelineData`'s own branch count under the oxlint complexity budget. */
function resolveExplicitVersionId(needsExplicit: boolean, requestedVersionId: string | undefined): number {
  if (!needsExplicit || requestedVersionId === undefined) return 0;
  return Number(requestedVersionId);
}

/** Split out purely to keep `useEditPipelineData`'s own branch count under the oxlint complexity budget. */
function pickActiveVersion(
  needsExplicit: boolean,
  explicitVersion: ApplicationVersionDetail | undefined,
  defaultVersion: ApplicationVersionDetail | undefined,
): ApplicationVersionDetail | undefined {
  return needsExplicit ? explicitVersion : defaultVersion;
}

/**
 * Split out of `EditPipeline.tsx` purely to keep that page's own cyclomatic
 * complexity under the oxlint budget (12) and its line count under the
 * §3.5 400-line file budget — same shape and same reason as
 * `pages/agents/lib/useEditApplicationData.ts` (Wave-2 unit A1g); a Pipeline
 * fetches through the exact same `GET /elitea_core/applications/prompt_lib/
 * {projectId}/{applicationId}` / `GET /elitea_core/version/prompt_lib/
 * {projectId}/{applicationId}/{versionId}` endpoints an Agent does (a
 * Pipeline literally IS an Application row).
 */
export function useEditPipelineData(
  projectId: string | undefined,
  applicationId: number | undefined,
  requestedVersionId: string | undefined,
): EditPipelineData {
  const detailQuery = useGetApplication(projectId ?? '', applicationId ?? 0, {
    query: { enabled: isDetailQueryEnabled(projectId, applicationId) },
  });
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const detail = detailQuery.data?.data as ApplicationDetail | undefined;
  const defaultVersion = detail?.version_details;

  const needsExplicit = needsExplicitVersionFetch(requestedVersionId, defaultVersion?.id);
  const explicitVersionId = resolveExplicitVersionId(needsExplicit, requestedVersionId);
  const versionQuery = useGetApplicationVersionDetail(projectId ?? '', applicationId ?? 0, explicitVersionId, {
    query: { enabled: isVersionQueryEnabled(needsExplicit, projectId, applicationId, explicitVersionId) },
  });
  const explicitVersion = versionQuery.data?.data as ApplicationVersionDetail | undefined;

  return {
    detail,
    versions: detail?.versions ?? EMPTY_VERSIONS,
    activeVersion: pickActiveVersion(needsExplicit, explicitVersion, defaultVersion),
    isFetching: combineQueryFlag(detailQuery.isFetching, needsExplicit, versionQuery.isFetching),
    isError: combineQueryFlag(detailQuery.isError, needsExplicit, versionQuery.isError),
    isDetailNotFound: isNotFoundApiError(detailQuery.error),
  };
}
