import { useCallback, useEffect, useMemo } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { UseValidateVersion } from '@/entities/application-form';
import {
  getGetApplicationVersionDetailQueryOptions,
  getValidateApplicationVersionQueryOptions,
} from '@/shared/api/generated/applications/applications';
import type { ApplicationVersionDetail as ApplicationVersionDetailWire } from '@/shared/api/generated/model';

import type { AgentToolAssociation } from '../lib/types';

import { buildVersionValidationKey, useApplicationsStore, type VersionValidationEntry } from './applicationsStore';

/**
 * Port of `apps/elitea-ui/src/hooks/application/useValidateApplicationVersion.js`.
 *
 * **`useValidateApplicationVersion` — real, narrower endpoint, same
 * conclusion `entities/application-form/model/validationStatus.ts` already
 * reached for this exact baseline hook, applied here to actually build the
 * hook that entity file's own doc comment says a caller must supply.** The
 * baseline drives per-tool error badges from `useValidateApplicationVersionQuery`,
 * whose 400 response carries `toolkit_errors`. The generated
 * `useValidateApplicationVersion` (`shared/api/generated/applications/
 * applications.ts`) is `GET .../version_validator/prompt_lib/...`, and
 * reading the Go handler directly
 * (`services/elitea-main/internal/api/v2/eliteacore/handler.go:1239-1249`,
 * `VersionValidator`) confirms it: a single `SELECT EXISTS(...)` existence
 * check, ALWAYS `writeJSON(w, http.StatusOK, ...)` — 200, never 400/422,
 * regardless of the result. `{valid: bool}` carries no `toolkit_errors`, and
 * this endpoint structurally CANNOT produce an "error" the way the baseline
 * expects (its only failure mode is network/auth, surfaced as `isError`
 * below). This function's shape (`{isError, error}` for
 * `{projectId, applicationId, versionId}` args, all possibly `undefined`,
 * `enabled` gated internally) matches `entities/application-form/ui/
 * ApplicationValidator.tsx`'s `UseValidateVersion` injection-point type
 * exactly, verified by conforming to it via `Parameters`/`ReturnType`
 * rather than restating the shape by hand.
 *
 * **`versionValidationInfo` (baseline: `slices/applications.js`, read via
 * `useToolsValidationInfo`/`useToolValidationInfo`) will always be empty
 * against the real backend.** It is still ported (onto
 * `applicationsStore.ts`, this unit's zustand replacement for the baseline
 * Redux slice) because the READ side (`useToolsValidationInfo`/
 * `useToolValidationInfo`) has real value the moment a real
 * toolkit-validation endpoint exists to WRITE into it — nothing here
 * invents that endpoint; this hook simply never calls
 * `setVersionValidationInfo` with non-empty content, because the real
 * `{valid: boolean}` response never gives it anything to write.
 *
 * **Two more pieces of the baseline's read-side logic are silently dropped
 * here, on top of the always-empty-store gap above** (currently dead code
 * either way, since nothing ever populates the store with real entries —
 * disclosed for completeness, not because it changes today's behaviour):
 * - `getSubAgentValidationKey` (baseline `useValidateApplicationVersion.js:
 *   18-27`): for an `application`-typed tool with no direct entry under the
 *   parent version's own validation key, the baseline falls back to that
 *   sub-agent's OWN validation-key entry (keyed by the sub-agent's own
 *   `application_id`/`application_version_id`) and joins its messages with
 *   `'; '`. `useToolsValidationInfo`/`useToolValidationInfo` below have no
 *   such fallback — a sub-agent tool with only its own-key errors and no
 *   parent-key entry reports no error here, vs. the baseline's joined
 *   message.
 * - `parseValidationMsg` (baseline `useValidateApplicationVersion.js:
 *   244-255`): `useToolValidationInfo` in the baseline attempts to
 *   `JSON.parse` a `"Value error, {...}"`-prefixed message and, when it
 *   decodes to an object carrying `error_type` (e.g.
 *   `private_credential_not_found`), returns that parsed object instead of
 *   the raw string. `useToolValidationInfo` below always returns the raw
 *   `msg` string verbatim — no such structured-error parsing.
 */

export interface UseValidateApplicationVersionOptions {
  /** Called when the underlying query enters an error state (network/auth — see module doc; the real endpoint's own body never signals a per-field error). Mirrors the baseline's `extractValidationInfo`'s toast side effect, minus the toast (see `useCreateApplication.ts` point 4's redesign precedent). */
  readonly onError?: (error: unknown) => void;
}

export function useValidateApplicationVersion(
  args: Parameters<UseValidateVersion>[0],
  options: UseValidateApplicationVersionOptions = {},
): ReturnType<UseValidateVersion> {
  const { projectId, applicationId, versionId } = args;
  const enabled = projectId !== undefined && applicationId !== undefined && versionId !== undefined;
  const queryOptions = getValidateApplicationVersionQueryOptions(projectId ?? '', applicationId ?? 0, versionId ?? 0, {
    query: { enabled },
  });
  const query = useQuery(queryOptions);
  const { onError } = options;

  useEffect(() => {
    if (query.isError) {
      onError?.(query.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onError` intentionally excluded, matching the baseline's own `useValidateApplicationVersion.js:62-66` effect (fires on isError/error change, not on every render/identity change of the callback).
  }, [query.isError, query.error]);

  return { isError: query.isError, error: query.error };
}

export interface UseManualValidateApplicationVersionInput {
  readonly applicationId: number | undefined;
  readonly projectId: string | undefined;
  readonly versionId: number | undefined;
  readonly tools: readonly AgentToolAssociation[] | undefined;
  readonly toolId: string | number | undefined;
  /** Baseline default: `true`. */
  readonly needValidateTheWholeAgent?: boolean;
}

/** What the caller should do with its own form state after `doValidateVersion` resolves — see the module doc comment's "no Formik" note and `model/types.ts`'s established "plain data out, caller owns the form mechanism" convention. */
export type ManualValidateOutcome =
  | { readonly kind: 'skipped' }
  | { readonly kind: 'availableToolsPatch'; readonly toolId: string | number; readonly availableTools: readonly unknown[] }
  | { readonly kind: 'toolsReplacement'; readonly tools: readonly AgentToolAssociation[] };

/** Split out of `doValidateVersion` purely to keep its cyclomatic complexity under the oxlint budget (12). */
async function validateSubApplicationIfPresent(
  subApplication: AgentToolAssociation | undefined,
  projectId: string,
  validateOne: (pid: string, appId: number, verId: number) => Promise<void>,
): Promise<void> {
  const appId = subApplication?.settings?.application_id;
  const verId = subApplication?.settings?.application_version_id;
  if (appId === undefined || verId === undefined) return;
  await validateOne(projectId, Number(appId), Number(verId));
}

/** Split out of `doValidateVersion` purely to keep its cyclomatic complexity under the oxlint budget (12). */
function resolveManualValidateOutcome(
  detailTools: readonly AgentToolAssociation[],
  dirty: boolean,
  toolId: string | number | undefined,
): ManualValidateOutcome {
  if (dirty && toolId !== undefined) {
    const availableTools = detailTools.find((tool) => tool.id !== toolId)?.settings?.available_tools ?? [];
    return { kind: 'availableToolsPatch', toolId, availableTools };
  }
  return { kind: 'toolsReplacement', tools: detailTools };
}

function findSubApplication(
  tools: readonly AgentToolAssociation[] | undefined,
  toolId: string | number | undefined,
): AgentToolAssociation | undefined {
  return tools?.find(
    (tool) =>
      tool.type === 'application' &&
      tool.id === toolId &&
      tool.settings?.application_id !== undefined &&
      tool.settings.application_version_id !== undefined,
  );
}

/**
 * @param dirty Whether the caller's form currently has unsaved edits — the
 * baseline reads this off `useFormikContext().dirty` to decide whether to
 * PATCH just the changed tool's `available_tools` (dirty: don't clobber the
 * user's other edits) or replace the whole `tools[]` array (clean: safe to
 * resync everything). Supplied explicitly (no ambient form context — same
 * redesign as `useSaveVersion.ts`/`useCreateApplication.ts`).
 */
export function useManualValidateApplicationVersion(
  input: UseManualValidateApplicationVersionInput,
  dirty: boolean,
): { readonly doValidateVersion: () => Promise<ManualValidateOutcome> } {
  const { tools, toolId } = input;
  const queryClient = useQueryClient();
  const setVersionValidationInfo = useApplicationsStore((state) => state.setVersionValidationInfo);

  const subApplication = useMemo(() => findSubApplication(tools, toolId), [tools, toolId]);

  const recordValidation = useCallback(
    (pid: string | undefined, appId: number | string | undefined, verId: number | string | undefined, entries: readonly VersionValidationEntry[]) => {
      setVersionValidationInfo(buildVersionValidationKey(pid, appId, verId), entries);
    },
    [setVersionValidationInfo],
  );

  const validateOne = useCallback(
    async (pid: string, appId: number, verId: number): Promise<void> => {
      try {
        await queryClient.query(getValidateApplicationVersionQueryOptions(pid, appId, verId));
        recordValidation(pid, appId, verId, []);
      } catch {
        // The real endpoint's only failure mode is network/auth (see the
        // module doc comment) — there is no `toolkit_errors` body to record.
        recordValidation(pid, appId, verId, []);
      }
    },
    [queryClient, recordValidation],
  );

  /**
   * `input` is read via `input.field` (rather than 5 separately-destructured
   * dependency-array entries) purely to stay under this codebase's
   * `hook-deps` budget (§3.5, 8 entries — `scripts/check-budgets.mjs`); same
   * rationale as `useCreateConfiguration.ts`'s identical comment.
   */
  const doValidateVersion = useCallback(async (): Promise<ManualValidateOutcome> => {
    const { applicationId, projectId, versionId, needValidateTheWholeAgent = true } = input;
    if (applicationId === undefined || projectId === undefined || versionId === undefined) {
      return { kind: 'skipped' };
    }

    await validateOne(projectId, applicationId, versionId);
    await validateSubApplicationIfPresent(subApplication, projectId, validateOne);

    if (!needValidateTheWholeAgent) {
      return { kind: 'skipped' };
    }

    const versionOptions = getGetApplicationVersionDetailQueryOptions(projectId, applicationId, versionId);
    const response = await queryClient.query(versionOptions);
    const detail = (response as { data: ApplicationVersionDetailWire }).data;
    const detailTools = (detail.tools ?? []) as readonly AgentToolAssociation[];

    return resolveManualValidateOutcome(detailTools, dirty, toolId);
  }, [input, dirty, queryClient, subApplication, toolId, validateOne]);

  return { doValidateVersion };
}

export interface UseToolsValidationInfoInput {
  readonly applicationId: number | undefined;
  readonly projectId: string | undefined;
  readonly versionId: number | undefined;
  readonly tools: readonly AgentToolAssociation[] | undefined;
}

/** Port of `useToolsValidationInfo` — reads the (currently always-empty; see module doc) shared validation-info store. */
export function useToolsValidationInfo(
  input: UseToolsValidationInfoInput,
): { readonly toolsValidationInfo: Readonly<Record<string, string>>; readonly totalValidationInfo: readonly string[] } {
  const { applicationId, projectId, versionId, tools } = input;
  const versionValidationInfo = useApplicationsStore((state) => state.versionValidationInfo);

  const toolsValidationInfo = useMemo(() => {
    if (applicationId === undefined || projectId === undefined || versionId === undefined || !tools?.length) {
      return {};
    }
    const key = buildVersionValidationKey(projectId, applicationId, versionId);
    const info: Record<string, string> = {};
    (versionValidationInfo[key] ?? []).forEach((entry) => {
      const loc = (entry as { loc?: readonly unknown[] }).loc;
      const id = loc?.[1];
      const found = tools.find((tool) => tool.id === id);
      const msg = (entry as { msg?: unknown }).msg;
      if ((typeof id === 'string' || typeof id === 'number') && found !== undefined && typeof msg === 'string') {
        info[String(id)] = msg;
      }
    });
    return info;
  }, [applicationId, projectId, tools, versionId, versionValidationInfo]);

  return { toolsValidationInfo, totalValidationInfo: Object.values(toolsValidationInfo) };
}

export interface UseToolValidationInfoInput {
  readonly applicationId: number | undefined;
  readonly projectId: string | undefined;
  readonly versionId: number | undefined;
  readonly toolId: string | number | undefined;
}

/** Port of `useToolValidationInfo` — single-tool read of the same store. */
export function useToolValidationInfo(input: UseToolValidationInfoInput): string {
  const { applicationId, projectId, versionId, toolId } = input;
  const versionValidationInfo = useApplicationsStore((state) => state.versionValidationInfo);

  return useMemo(() => {
    const key = buildVersionValidationKey(projectId, applicationId, versionId);
    const parentError = (versionValidationInfo[key] ?? []).find(
      (entry) => (entry as { loc?: readonly unknown[] }).loc?.[1] === toolId,
    );
    const msg = (parentError as { msg?: unknown } | undefined)?.msg;
    return typeof msg === 'string' ? msg : '';
  }, [applicationId, projectId, toolId, versionId, versionValidationInfo]);
}
