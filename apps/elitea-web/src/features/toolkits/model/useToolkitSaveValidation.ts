/**
 * The production supplier of `ToolkitForm`'s `toolkitValidation` channel
 * (#613).
 *
 * `ToolkitForm.configuration.hooks.ts` has always held the effect that turns a
 * server `settings_errors` array into per-field errors — it merges them into
 * `mergedToolErrors`, which both paints the offending field and drives
 * `hasErrors`. NOTHING in the app ever supplied the prop it reads, so the whole
 * channel was inert: a toolkit save that the server refused surfaced as a
 * generic banner at best, and as silence at worst.
 *
 * THE ERROR ARRIVES ON THE SAVE, NOT ON A QUERY. `ToolkitValidationInjected` is
 * shaped like an RTK-Query result because the baseline fed it from one, but
 * this app has no toolkit-validation query and a create has no persisted
 * toolkit id to query BY. The refusal that matters is the 400 from
 * `POST /elitea_core/tools/prompt_lib/{projectId}` and
 * `PUT /elitea_core/tool/prompt_lib/{projectId}/{toolId}` — which is why this
 * hook takes a rejected save and re-presents it in the shape the effect reads.
 *
 * TWO THINGS ARE LOAD-BEARING AND EASY TO GET WRONG:
 *
 *  1. THE TRANSPORT SHAPE. `ToolkitValidationInjected.error` declares `.data`,
 *     and this app's HTTP layer NEVER produces that: a rejected `eliteaFetch`
 *     throws `EliteaApiError` carrying `failure.body` (`shared/api/http.ts`'s
 *     `HttpFailure`). A supplier written to the declared type without this
 *     adapter compiles, passes every existing test, and reads `undefined` at
 *     run time.
 *  2. MEMOIZATION. The consuming effect's dependency array is
 *     `[toolkitValidation, …]` and its non-error branch calls
 *     `setServerToolErrors({})`. A supplier returning a fresh object literal
 *     each render therefore re-runs the effect and sets a NEW empty object
 *     every render — a live re-render loop. The value below changes identity
 *     only when the stored errors do.
 */
import { useCallback, useMemo, useState } from 'react';

import { EliteaApiError } from '@/shared/api/generated/mutator';

import { parseValidationErrors } from '../lib/helpers/toolkitForm.helpers';
import type { ValidationErrorEntry } from '../lib/helpers/toolkitForm.helpers';
import type { ToolkitValidationInjected } from '../ui/form/ToolkitForm/ToolkitForm.types';

export interface ToolkitSaveValidation {
  /** Hand this straight to `<ToolkitForm toolkitValidation={…}>`. Stable across renders until the stored errors change. */
  readonly toolkitValidation: ToolkitValidationInjected;
  /**
   * Records a rejected save. Returns `true` only when the rejection carried at
   * least one entry `parseValidationErrors` can key to a field — i.e. when
   * something will actually be painted — so the caller can suppress its generic
   * "save failed" banner in favour of those field errors. A rejection that
   * carries `settings_errors` the client cannot key is recorded as nothing and
   * reported as `false`, so the banner still shows it.
   */
  readonly reportSaveError: (error: unknown) => boolean;
  /** Drops the recorded errors — call before re-issuing a save. */
  readonly clearSaveErrors: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `settings_errors` entries, from wherever the rejection put them.
 *
 * `loc` is NOT normalised here: the server sends `["settings", "<field>"]` and
 * `parseValidationErrors` keys on `loc[1]`, dropping anything shorter. Silently
 * padding a one-element `loc` would invent a field name.
 */
function readSettingsErrors(body: unknown): readonly ValidationErrorEntry[] | undefined {
  if (!isRecord(body)) return undefined;
  const raw = body['settings_errors'];
  if (!Array.isArray(raw)) return undefined;
  const entries = raw.filter(isRecord).map((entry) => ({
    ...(typeof entry['msg'] === 'string' ? { msg: entry['msg'] } : {}),
    ...(Array.isArray(entry['loc']) ? { loc: entry['loc'] as readonly unknown[] } : {}),
  }));
  return entries.length > 0 ? entries : undefined;
}

function toSettingsErrors(error: unknown): readonly ValidationErrorEntry[] | undefined {
  if (error instanceof EliteaApiError) {
    // Only `kind: 'http'` carries a body at all; `auth`/`network`/`aborted` do
    // not, and inventing field errors for a dropped connection would blame the
    // user's input for the network.
    return error.failure.kind === 'http' ? readSettingsErrors(error.failure.body) : undefined;
  }
  // A caller that already unwrapped the body (or a future transport that hands
  // one over directly) is accepted too, so this hook is not tied to one error class.
  return readSettingsErrors(error);
}

export function useToolkitSaveValidation(): ToolkitSaveValidation {
  const [settingsErrors, setSettingsErrors] = useState<readonly ValidationErrorEntry[] | undefined>(undefined);

  const clearSaveErrors = useCallback(() => setSettingsErrors(undefined), []);

  /**
   * ONE PREDICATE DRIVES BOTH DECISIONS, and it is the same one the consuming
   * effect uses.
   *
   * The presence of a non-empty `settings_errors` array is NOT that predicate.
   * `parseValidationErrors` drops every entry it cannot key to a field —
   * anything whose `loc[1]` is missing (`toolkitForm.helpers.ts`'s
   * `locFieldKey`) — and this handler's OTHER `settings_errors` emitter, the
   * `ValidateToolkit` route, emits a one-element `loc` today. Returning `true`
   * on presence alone therefore produced a COMPLETELY SILENT failed save for
   * any refusal whose shape drifted: `CreateToolkit.tsx` suppressed its generic
   * banner on the `true`, `ToolkitForm.configuration.hooks.ts` painted no field
   * error because the parsed map was empty, and the page's
   * `if (toolkitValidation.isError) return` guard additionally latched Save
   * shut until the user happened to edit something.
   *
   * Recording nothing when nothing is keyable keeps `isError`, the painted
   * fields and the banner in agreement: a refusal is either shown on a field or
   * shown in the banner, never neither.
   */
  const reportSaveError = useCallback((error: unknown): boolean => {
    const entries = toSettingsErrors(error);
    const keyed = Object.keys(parseValidationErrors(entries)).length > 0;
    setSettingsErrors(keyed ? entries : undefined);
    return keyed;
  }, []);

  const toolkitValidation = useMemo<ToolkitValidationInjected>(
    () => ({
      isError: settingsErrors !== undefined,
      error: settingsErrors === undefined ? undefined : { data: { settings_errors: settingsErrors } },
      // The form calls this after a credential is reloaded or re-created. There
      // is nothing to re-fetch — the answer comes from the next save — so the
      // honest response is to drop the stale refusal.
      refetch: clearSaveErrors,
    }),
    [settingsErrors, clearSaveErrors],
  );

  // The WHOLE result is memoized, not just `toolkitValidation`: a consumer that
  // reads all three members inside one `useCallback` would otherwise spend three
  // dependency slots on a value that changes as one thing (and blow the §3.5
  // hook-deps budget doing it).
  return useMemo(
    () => ({ toolkitValidation, reportSaveError, clearSaveErrors }),
    [toolkitValidation, reportSaveError, clearSaveErrors],
  );
}
