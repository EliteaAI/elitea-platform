/**
 * REST client for the branding package (ADR-0024 WP9) —
 * `/api/v2/admin/branding/package/administration` and its `versions` tree.
 *
 * Same shape as `adminBrandingApi.ts`: the reads are `useQuery` over the
 * generated fetchers, the writes are locally-owned `useMutation`s over the
 * generated `importBrandingPackage` / `restoreBrandingPackageVersion` (orval
 * emits its POST hooks query-shaped, which would dedupe and auto-retry an
 * import). Two things are particular to this module:
 *
 *  - A REFUSED import answers 400 with the report shape — `problems` named
 *    entry by entry — and the operator needs that report, not a thrown error.
 *    The mutation resolves such a 400 to the report; only 413/503 and
 *    transport failures reject.
 *  - The export is a zip. `eliteaFetch` reads every body as text
 *    (`http.ts`'s `toResult`), so the download goes through
 *    `shared/lib/download.ts`'s sanctioned raw fetch with the base URL the
 *    admin bundle configured its client with.
 *
 * Every route is gated server-side on `configuration.branding`.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  getExportBrandingPackageUrl,
  getGetBrandingSettingsQueryKey,
  getListBrandingPackageVersionsQueryKey,
  importBrandingPackage,
  listBrandingPackageVersions,
  restoreBrandingPackageVersion,
} from '@/shared/api/generated/admin/admin';
import type { BrandingPackageReport, BrandingPackageVersion } from '@/shared/api/generated/model';
import { EliteaApiError } from '@/shared/api/generated/mutator';
import { downloadFromApi, type ApiDownloadResult } from '@/shared/lib/download';

import { adminApiBaseUrl } from '../adminUiConfig';
import { parseBrandingPackageReport } from '../brandingPackage';

/** The report inside a 400, when the refusal carried one. */
function refusedReport(error: unknown): BrandingPackageReport | undefined {
  if (!(error instanceof EliteaApiError)) return undefined;
  const failure = error.failure;
  if (failure.kind !== 'http' || failure.status !== 400) return undefined;
  return parseBrandingPackageReport(failure.body);
}

/** `GET …/versions` — the kept packages, newest first. */
export function useBrandingPackageVersions(): UseQueryResult<readonly BrandingPackageVersion[], Error> {
  return useQuery({
    queryKey: getListBrandingPackageVersionsQueryKey(),
    queryFn: async ({ signal }): Promise<readonly BrandingPackageVersion[]> => {
      const response = await listBrandingPackageVersions({ signal });
      if (response.status !== 200) throw new Error(`package versions answered ${response.status}`);
      return response.data.versions;
    },
  });
}

export interface BrandingPackageImport {
  readonly file: File;
  readonly dryRun: boolean;
}

/** After an applied import or restore, both the settings and the kept versions changed. */
function useInvalidateAfterApply(): (report: BrandingPackageReport) => Promise<void> {
  const queryClient = useQueryClient();
  return async (report) => {
    if (!report.applied) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetBrandingSettingsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListBrandingPackageVersionsQueryKey() }),
    ]);
  };
}

/** `POST …/package/administration[?dry_run=true]` — one multipart `file` part. */
export function useImportBrandingPackage(): UseMutationResult<BrandingPackageReport, Error, BrandingPackageImport> {
  const invalidate = useInvalidateAfterApply();
  return useMutation({
    mutationFn: async ({ file, dryRun }: BrandingPackageImport): Promise<BrandingPackageReport> => {
      try {
        const response = await importBrandingPackage({ file }, dryRun ? { dry_run: true } : undefined);
        if (response.status !== 200) throw new Error(`package import answered ${response.status}`);
        return response.data;
      } catch (error) {
        const report = refusedReport(error);
        if (report === undefined) throw error;
        return report;
      }
    },
    onSuccess: invalidate,
  });
}

/** `POST …/versions/{digest}/restore`. */
export function useRestoreBrandingPackageVersion(): UseMutationResult<BrandingPackageReport, Error, string> {
  const invalidate = useInvalidateAfterApply();
  return useMutation({
    mutationFn: async (digest: string): Promise<BrandingPackageReport> => {
      try {
        const response = await restoreBrandingPackageVersion(digest);
        if (response.status !== 200) throw new Error(`package restore answered ${response.status}`);
        return response.data;
      } catch (error) {
        const report = refusedReport(error);
        if (report === undefined) throw error;
        return report;
      }
    },
    onSuccess: invalidate,
  });
}

const BRANDING_PACKAGE_FALLBACK_NAME = 'branding.zip';

/** `GET …/package/administration` → the browser's save-as flow. Resolves the outcome; never rejects on a refusal. */
export function useDownloadBrandingPackage(): UseMutationResult<ApiDownloadResult, Error, void> {
  return useMutation({
    mutationFn: () =>
      downloadFromApi({
        baseUrl: adminApiBaseUrl(),
        path: getExportBrandingPackageUrl(),
        fallbackName: BRANDING_PACKAGE_FALLBACK_NAME,
      }),
  });
}
