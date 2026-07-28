import { useEffect, useMemo } from 'react';

import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { toolkitValidationErrors } from '@/entities/toolkit';
import { buildErrorMessage } from '@/shared/lib/http-error';

/**
 * Ported from `apps/elitea-ui/src/hooks/application/useValidateToolkit.js`
 * (both exports — `useValidateToolkit` default export and the named
 * `useToolkitValidationInfo`; Wave-2 unit A1e).
 *
 * The settings/connection-error combination itself was already promoted
 * verbatim to `entities/toolkit`'s `toolkitValidationErrors` (Wave-2
 * promotion pass, Part 3 — see that file's own doc comment) and is reused
 * here rather than re-implemented.
 *
 * **REAL BACKEND GAP (disclosed, matches `entities/toolkit/model/
 * validationStatus.ts`'s own documented finding):** grepping the entire
 * generated client (`shared/api/generated/toolkits/toolkits.ts`) for
 * `validate` (case-insensitive) returns zero hits — only `useListToolkits`
 * and `useListToolkitInstances` exist. There is currently NO generated
 * endpoint for toolkit validation at all. Wrapping some OTHER endpoint and
 * pretending it were this one would be actively wrong, so — matching the
 * established convention for exactly this situation
 * (`entities/application-form/ui/ApplicationValidator.tsx`'s injected
 * `useValidate` prop) — the actual network call is dependency-injected via
 * `useValidateToolkitQuery`. A caller supplies it once a real endpoint
 * exists to wrap; this hook only owns the orchestration (skip conditions,
 * error-shape parsing, cross-component validation-info storage) the
 * baseline hard-coded around its own `useValidateToolkitQuery` RTK Query
 * hook.
 *
 * **DEVIATIONS FROM BASELINE (both disclosed):**
 *  1. `McpAuthHelpers.getAllTokens()` (collecting stored OAuth tokens to
 *     forward as `X-Toolkit-Tokens`) is `mcp`-feature-domain, out of this
 *     unit's ownership fence, and has no promoted `entities/` home either.
 *     Since the whole validation CALL is injected (deviation above), the
 *     injected `useValidateToolkitQuery` is exactly where that token
 *     collection belongs once it's wired — this hook does not need to know
 *     about MCP tokens at all.
 *  2. No toast infrastructure exists in this app yet (see
 *     `features/mcps/model/useMcpAuthCheck.ts`'s own "`useToast` is
 *     replaced with an `onError` callback" precedent) — the baseline's
 *     `toastError(buildErrorMessage(error))` call becomes an injected
 *     `onError` callback instead.
 *  3. `dispatch(actions.setToolkitValidationInfo(...))` / `useSelector(state
 *     => state.chat.toolkitValidationInfo)` (Redux) are replaced with a
 *     zustand lazy-singleton store — the established substitute for a
 *     baseline Redux slice with no other home (see
 *     `features/agents/model/applicationsStore.ts`'s own doc comment,
 *     `widgets/app-shell/model/navBlocker.store.ts`'s lazy-singleton
 *     factory pattern, mirrored here verbatim).
 */

/**
 * Structurally compatible with `entities/toolkit`'s (non-exported)
 * `ToolkitValidationErrorEntry` — that type itself isn't re-exported from
 * `entities/toolkit`'s public `index.ts` (only the `toolkitValidationErrors`
 * VALUE is), and R-L3 forbids a deep import to `model/validationStatus.ts`
 * to reach it, so this is `ReturnType<typeof toolkitValidationErrors>`'s
 * element type instead — always exactly in sync with the real return type,
 * with no local duplication of the shape's fields to drift.
 */
export type ToolkitValidationEntry = ReturnType<typeof toolkitValidationErrors>[number];

/** Structurally compatible with `entities/toolkit`'s (non-exported) `ToolkitValidationErrorBody` — see `toolkitValidationErrors`'s own parameter type. */
export interface ToolkitValidationErrorBodyLike {
  readonly settings_errors?: readonly Record<string, unknown>[];
  readonly connection_errors?: readonly {
    readonly message?: string;
    readonly configuration_title?: string;
    readonly configuration_type?: string;
    readonly requires_authorization?: boolean;
    readonly auth_metadata?: unknown;
  }[];
}

/* ── cross-component validation-info store (deviation 3) ─────────────────── */

interface ToolkitValidationStoreState {
  readonly infoByKey: Readonly<Record<string, readonly ToolkitValidationEntry[]>>;
  readonly setToolkitValidationInfo: (key: string, info: readonly ToolkitValidationEntry[]) => void;
}

type ToolkitValidationStore = UseBoundStore<StoreApi<ToolkitValidationStoreState>>;

function createToolkitValidationStore(): ToolkitValidationStore {
  return create<ToolkitValidationStoreState>((set) => ({
    infoByKey: {},
    setToolkitValidationInfo: (key, info) => set((state) => ({ infoByKey: { ...state.infoByKey, [key]: info } })),
  }));
}

let instance: ToolkitValidationStore | undefined;

function resolveStore(): ToolkitValidationStore {
  instance ??= createToolkitValidationStore();
  return instance;
}

function useToolkitValidationStoreHook<T>(selector: (state: ToolkitValidationStoreState) => T): T {
  return resolveStore()(selector);
}

/** @public The lazily-constructed singleton — same hook + getState surface convention as `widgets/app-shell/model/navBlocker.store.ts`'s `useNavBlockerStore`. Exported for tests; not part of this slice's `index.ts` public API (an internal implementation detail of `useValidateToolkit`/`useToolkitValidationInfo`). */
export const useToolkitValidationStore = Object.assign(useToolkitValidationStoreHook, {
  getState: (): ToolkitValidationStoreState => resolveStore().getState(),
});

/** `${projectId}_${toolkitId}` — the baseline's own `selectorKey`/dispatch key, byte-for-byte. */
export function buildToolkitValidationKey(projectId: string | undefined, toolkitId: string | undefined): string {
  return `${String(projectId)}_${String(toolkitId)}`;
}

/* ── the validation call itself (deviation 1) ─────────────────────────────── */

export interface ValidateToolkitArgs {
  readonly projectId: string | undefined;
  readonly toolkitId: string | undefined;
  readonly forceSkip?: boolean;
}

export interface ValidateToolkitQueryResult {
  readonly isError: boolean;
  /** Whatever the injected query rejects with — shape depends on the real endpoint once one exists (mirrors `ApplicationValidator.tsx`'s `ValidateVersionResult.error`). */
  readonly error: unknown;
}

export type UseValidateToolkitQuery = (args: ValidateToolkitArgs) => ValidateToolkitQueryResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = error['status'];
  return typeof status === 'number' ? status : undefined;
}

function extractErrorBody(error: unknown): ToolkitValidationErrorBodyLike | undefined {
  if (!isRecord(error)) return undefined;
  const data = error['data'];
  return isRecord(data) ? data : undefined;
}

/** Safe stringification of an arbitrary rejected error — same technique as `lib/associationError.ts`'s `describeRawError`/`features/mcps/model/useMcpAuthCheck.ts`'s `describeContent` (never `[object Object]`). */
function describeValidationError(error: unknown): string {
  const built = buildErrorMessage(error);
  if (typeof built === 'string') return built;
  if (built === undefined || built === null) return '';
  try {
    return JSON.stringify(built);
  } catch {
    return '';
  }
}

export interface UseValidateToolkitParams {
  readonly projectId: string | undefined;
  readonly toolkitId: string | undefined;
  /** @default false */
  readonly forceSkip?: boolean;
  /** Injected rather than called internally — see the module doc comment, deviation/gap 1. */
  readonly useValidateToolkitQuery: UseValidateToolkitQuery;
  /** Replaces the baseline's `toastError` — see the module doc comment, deviation 2. Only called for non-400 errors, matching the baseline's own `error?.status !== 400` guard. */
  readonly onError?: (message: string) => void;
}

export function useValidateToolkit({
  projectId,
  toolkitId,
  forceSkip = false,
  useValidateToolkitQuery,
  onError,
}: UseValidateToolkitParams): void {
  const result = useValidateToolkitQuery({ projectId, toolkitId, forceSkip });

  useEffect(() => {
    if (!result.isError) return;

    if (extractErrorStatus(result.error) !== 400) {
      onError?.(describeValidationError(result.error));
    }

    const validationInfo = toolkitValidationErrors(extractErrorBody(result.error));
    resolveStore().getState().setToolkitValidationInfo(buildToolkitValidationKey(projectId, toolkitId), validationInfo);
  }, [result.isError, result.error, onError, projectId, toolkitId]);
}

export interface UseToolkitValidationInfoParams {
  readonly projectId: string | undefined;
  readonly toolkitId: string | undefined;
}

export interface UseToolkitValidationInfoResult {
  readonly toolkitValidationInfoList: readonly ToolkitValidationEntry[];
}

const EMPTY_VALIDATION_INFO: readonly ToolkitValidationEntry[] = [];

export function useToolkitValidationInfo({ projectId, toolkitId }: UseToolkitValidationInfoParams): UseToolkitValidationInfoResult {
  const key = useMemo(() => buildToolkitValidationKey(projectId, toolkitId), [projectId, toolkitId]);
  const info = useToolkitValidationStore((state) => (projectId !== undefined && toolkitId !== undefined ? state.infoByKey[key] : undefined));
  return { toolkitValidationInfoList: info ?? EMPTY_VALIDATION_INFO };
}
