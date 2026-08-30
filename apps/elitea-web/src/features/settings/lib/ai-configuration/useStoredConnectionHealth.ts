/**
 * useStoredConnectionHealth — the AI Configuration panel's per-card
 * connection health, over the SAVED-row check routes.
 *
 * ## Two different questions, two different routes
 *
 * `POST /configurations/check_stored_connections/{projectId}` (batch) and
 * `POST /configurations/check_stored_connection/{projectId}/{configId}`
 * (single) dial the real provider. They carry NO request body: the server
 * reads the row and redeems its sealed secret through the project vault, so
 * a stored api_key is never sent from — or held by — the browser. Nothing on
 * this screen has the secret to send in the first place.
 *
 * `POST /configurations/revalidate/{projectId}/{configId}` asks the OTHER
 * question and is the per-card "Re-validate" action. It re-runs ADMISSION —
 * do the row's references still expand, do its secrets still redeem, does
 * policy still admit the project to own it — persists the answer in
 * `status_ok`, and contacts no provider at all. The two are deliberately
 * separate server-side: a provider outage must not withdraw a project's
 * credentials from the gateway, and a credential whose vault secret was
 * deleted must not stay usable because the provider still answers. Both
 * outcomes land on the same dot here because a card has one dot, but they
 * are not interchangeable and the tooltip says which ran.
 *
 * ## Manual trigger, on purpose
 *
 * Nothing fires on mount. A project can hold dozens of configurations, and
 * checking each one is a real provider round trip billed in latency; the
 * legacy panel had a check-all action for the same reason. `checkAll` is
 * wired to the panel's "Check connections" button, and re-pressing it is the
 * refresh affordance.
 *
 * ## Why the generated client and not `features/credentials`
 *
 * `features/credentials/api/configurations.ts` holds hand-written fetchers
 * for these same three routes, but `.dependency-cruiser.cjs`'s
 * `no-sideways-features` forbids `features/settings` importing another
 * feature slice — the same constraint, and the same resolution, as
 * `../../ui/ai-configuration/RequestModelConnection.tsx` ("The generated
 * client in `shared/` is the shared part, and it is what both call") and
 * `ConfigurationSection.tsx`'s local `useCanEditConfiguration`. The
 * generated client is orval's output for the very operations that spec
 * describes, so both callers speak one contract.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { useMutation } from '@tanstack/react-query';

import {
  batchCheckStoredConfigurationConnections,
  revalidateConfiguration,
} from '@/shared/api/generated/configurations/configurations';
import { t } from '@/shared/i18n';
import type { StoredConnectionCheckRow } from '@/shared/api/generated/model';

/** `unchecked` is the resting state: no request has named this row yet. It is NOT "healthy" and NOT "broken", and the dot must not imply either. */
type StoredConnectionHealthStatus = 'unchecked' | 'checking' | 'ok' | 'failed' | 'unsupported';

export interface StoredConnectionHealth {
  readonly status: StoredConnectionHealthStatus;
  /** The server's own words for a failure — never a synthesized one, so a real "no message" case stays empty instead of inventing wording. */
  readonly message?: string;
  /** Set only by a Re-validate: the row's freshly re-derived `status_ok`. Absent means "nobody has re-derived it in this session". */
  readonly statusOk?: boolean;
}

export interface UseStoredConnectionHealthResult {
  readonly health: Readonly<Record<string, StoredConnectionHealth>>;
  /** Fires the batch check for every id passed to the hook. Safe to press again — that is the refresh. */
  readonly checkAll: () => void;
  readonly revalidate: (configurationId: string) => void;
  readonly isChecking: boolean;
  readonly revalidatingId: string | undefined;
  /** A transport-level failure of the batch itself (not a per-row failure), for the panel to show once beside the button. */
  readonly checkError: string;
}

/** The route's own documented cap (`BatchCheckStoredConfigurationConnectionsBody.configuration_ids`: "at most 200"). Sending more is a 4xx, which would report every row as unchecked rather than checking the first 200. */
const MAX_BATCH_IDS = 200;

const EMPTY_HEALTH: Readonly<Record<string, StoredConnectionHealth>> = {};

/**
 * The row's `id` comes back "unchanged and in the type it arrived as", so a
 * numeric id sent as a JSON string returns a string and one sent as a number
 * returns a number. Keying by `String(...)` on both ends is what makes the
 * match hold either way.
 */
function rowKey(id: StoredConnectionCheckRow['id']): string {
  return String(id);
}

function toHealth(row: StoredConnectionCheckRow): StoredConnectionHealth {
  if (row.unsupported === true) return { status: 'unsupported' };
  if (row.success) return { status: 'ok' };
  // `exactOptionalPropertyTypes`: an absent message must be an absent KEY.
  return row.message !== undefined && row.message !== ''
    ? { status: 'failed', message: row.message }
    : { status: 'failed' };
}

function checkingEntries(ids: readonly string[]): Record<string, StoredConnectionHealth> {
  const next: Record<string, StoredConnectionHealth> = {};
  for (const id of ids) next[id] = { status: 'checking' };
  return next;
}

/**
 * A batch that never answered tells us NOTHING about the rows. Returning them
 * to `unchecked` (rather than to `failed`, which is what the legacy panel
 * did) is the same call the server makes when it always answers 200 with per
 * row verdicts: a transport failure must not paint a healthy project red.
 * The reason is surfaced once, beside the button that started it.
 */
function clearedEntries(ids: readonly string[]): Record<string, StoredConnectionHealth> {
  const next: Record<string, StoredConnectionHealth> = {};
  for (const id of ids) next[id] = { status: 'unchecked' };
  return next;
}


/**
 * One configuration row's id as a string key.
 *
 * The `id` is read off a `Record<string, unknown>` (the panel's configuration
 * rows are untyped wire objects), so a bare `String(...)` on it is a
 * `no-base-to-string` error — and rightly: an object id would stringify to
 * `"[object Object]"` and silently key a dot that can never match a response
 * row. Anything that is not a string or a number yields `""`, which the
 * callers skip.
 */
export function toConfigurationId(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

/**
 * Every configuration id on a panel, across all its sections, in render
 * order. These ids are the ONLY thing the batch request carries: the check
 * sends no payload, because the stored secret is sealed and the browser does
 * not have it.
 *
 * A row with no `id` is skipped rather than sent as `""` — the server would
 * answer "not found" for it and paint a dot the user cannot act on.
 */
export function collectConfigurationIds(configurationsBySection: Record<string, Record<string, unknown>[]>): string[] {
  const ids: string[] = [];
  for (const section of Object.values(configurationsBySection)) {
    for (const configuration of section ?? []) {
      const id = toConfigurationId(configuration.id);
      if (id !== '') ids.push(id);
    }
  }
  return ids;
}

export function useStoredConnectionHealth(
  projectId: string,
  configurationIds: readonly string[],
): UseStoredConnectionHealthResult {
  const [health, setHealth] = useState<Readonly<Record<string, StoredConnectionHealth>>>(EMPTY_HEALTH);
  const [checkError, setCheckError] = useState('');
  const [revalidatingId, setRevalidatingId] = useState<string | undefined>(undefined);

  // `configurationIds` arrives as a fresh array on most renders (the panel
  // derives it from a prop object), so the joined key — not the array — is
  // what decides whether the memo actually changes.
  const idsKey = configurationIds.join(',');
  const ids = useMemo(() => configurationIds.slice(0, MAX_BATCH_IDS).map(String), [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed on the joined id list; the array identity itself is unstable by construction.

  const batchMutation = useMutation({
    mutationFn: (input: { readonly projectId: string; readonly ids: readonly string[] }) =>
      batchCheckStoredConfigurationConnections(input.projectId, { configuration_ids: [...input.ids] }),
  });

  const revalidateMutation = useMutation({
    mutationFn: (input: { readonly projectId: string; readonly configId: string }) =>
      revalidateConfiguration(input.projectId, input.configId),
  });

  const { mutateAsync: runBatch } = batchMutation;
  const checkAll = useCallback((): void => {
    if (ids.length === 0) return;
    setCheckError('');
    setHealth((prev) => ({ ...prev, ...checkingEntries(ids) }));
    void runBatch({ projectId, ids })
      .then((response) => {
        if (response.status !== 200) return;
        const updates: Record<string, StoredConnectionHealth> = {};
        for (const row of response.data) updates[rowKey(row.id)] = toHealth(row);
        setHealth((prev) => ({ ...prev, ...updates }));
      })
      .catch(() => {
        setHealth((prev) => ({ ...prev, ...clearedEntries(ids) }));
        setCheckError(t('ai-configuration.health.checkFailed', 'The connection check could not be run.'));
      });
  }, [ids, projectId, runBatch]);

  const { mutateAsync: runRevalidate } = revalidateMutation;
  const revalidate = useCallback(
    (configurationId: string): void => {
      setCheckError('');
      setRevalidatingId(configurationId);
      setHealth((prev) => ({ ...prev, [configurationId]: { status: 'checking' } }));
      void runRevalidate({ projectId, configId: configurationId })
        .then((response) => {
          if (response.status !== 200) return;
          const row = response.data;
          // Revalidate re-derives ADMISSION, not a provider verdict — see this
          // module's own doc comment. `status_logs` is the row's own account of
          // why admission failed, which is the only message this route carries.
          setHealth((prev) => ({
            ...prev,
            [configurationId]: {
              status: row.status_ok ? 'ok' : 'failed',
              statusOk: row.status_ok,
              ...(row.status_logs !== undefined && row.status_logs !== '' ? { message: row.status_logs } : {}),
            },
          }));
        })
        .catch(() => {
          setHealth((prev) => ({ ...prev, [configurationId]: { status: 'unchecked' } }));
          setCheckError(t('ai-configuration.health.revalidateFailed', 'The configuration could not be re-validated.'));
        })
        .finally(() => {
          setRevalidatingId(undefined);
        });
    },
    [projectId, runRevalidate],
  );

  return {
    health,
    checkAll,
    revalidate,
    isChecking: batchMutation.isPending,
    revalidatingId,
    checkError,
  };
}

/* ── panel → card delivery ──────────────────────────────────────────────── */

/**
 * The verdicts as a CARD needs them, plus the per-card Re-validate action.
 *
 * Delivered by context rather than by prop, for one concrete reason:
 * `ConfigurationSection` sits between the panel and the cards and already
 * destructures exactly 12 props, which is the §3.5 `component-props` budget.
 * A 13th breaks `scripts/check-budgets.mjs`, and regrouping that component's
 * public prop list would rewrite all seven of the panel's call sites for a
 * value that section does not itself use — it only forwards it. The card
 * boundary stays explicit: `ConfigCards` reads this context once and passes
 * `health`/`onRevalidate`/`isRevalidating` down as ordinary props, so
 * `ConfigurationCard` is still renderable, and testable, on its own.
 */
export interface StoredConnectionHealthView {
  readonly health: Readonly<Record<string, StoredConnectionHealth>>;
  readonly revalidate?: ((configurationId: string) => void) | undefined;
  readonly revalidatingId?: string | undefined;
}

/** The default is deliberately inert: a card rendered outside the panel shows every dot `unchecked` and offers no Re-validate, rather than throwing. */
const StoredConnectionHealthContext = createContext<StoredConnectionHealthView>({ health: EMPTY_HEALTH });

export const StoredConnectionHealthProvider = StoredConnectionHealthContext.Provider;

export function useStoredConnectionHealthContext(): StoredConnectionHealthView {
  return useContext(StoredConnectionHealthContext);
}
