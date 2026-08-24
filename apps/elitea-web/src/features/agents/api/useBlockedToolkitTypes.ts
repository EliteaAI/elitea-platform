import { useGetPlatformSettings } from '@/shared/api/generated/admin/admin';
import type { PlatformSettings } from '@/shared/api/generated/model';

/**
 * The guardrails blocklist, for marking an existing toolkit blocked.
 *
 * **The gap this closes.** `lib/toolkitBlocklist.ts` ported the baseline's
 * `isToolkitTypeBlocked` faithfully but had to take the blocklist as a
 * PARAMETER, because the baseline read it from a module-level constant
 * (`common/constants.js`'s `getEnvVar('blocked_toolkits', [])`) and this app
 * had no equivalent source. Its header, `toolkits.helpers.ts`'s header and
 * `ToolCard.types.ts`'s `blockedToolkitTypes` field all recorded that as a
 * disclosed gap awaiting a real source. No production caller ever passed the
 * parameter, so `isBlockedToolkit` was computed on every ToolCard render and
 * was structurally always `false` — the blocked-toolkit banner could not
 * appear on any screen. Only tests supplied it.
 *
 * The source exists now: the admin Configuration page's Guardrails section
 * writes `blocked_toolkits` into `centry.platform_config` and eliteacore's
 * PlatformSettings handler marshals it. Same endpoint and same hook shape as
 * `useIsMcpVisible` beside this file.
 *
 * ## What this is and is not
 *
 * PRESENTATION of a decision the server already enforces, never the decision.
 * A blocked toolkit is dropped from the type catalogue, refused with a 403 on
 * create/update/fork, and stripped out of the agent tool freeze before the run.
 * This only paints the rows the server deliberately keeps returning — the
 * toolkit INSTANCE list is not filtered, so an administrator can still see and
 * delete the toolkits of a blocked type that already exist rather than having
 * them vanish with their settings and vault references.
 *
 * ## The empty-list convention
 *
 * An absent or unreadable field yields `[]`, which blocks nothing. That is the
 * permissive direction on purpose: this value decides only how a toolkit is
 * PAINTED, and painting every toolkit blocked because one response was odd
 * would be a far louder failure than painting none. The enforcement that
 * matters does not live here.
 *
 * The values are canonical comparison keys, and `isToolkitTypeBlocked`
 * canonicalises again before comparing — canonicalising a canonical key is a
 * no-op, so the hook does not need to know which form it received.
 */
export function useBlockedToolkitTypes(): readonly string[] {
  const query = useGetPlatformSettings();
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here, since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const platformSettings = query.data?.data as PlatformSettings | undefined;
  const blocked = platformSettings?.blocked_toolkits;
  // Filtered rather than trusted: the field is `additionalProperties`-adjacent
  // on a permissive schema, and one non-string entry must not make the whole
  // list unusable — nor be canonicalised into a key that matches a real
  // toolkit.
  return Array.isArray(blocked) ? blocked.filter((entry): entry is string => typeof entry === 'string') : [];
}
