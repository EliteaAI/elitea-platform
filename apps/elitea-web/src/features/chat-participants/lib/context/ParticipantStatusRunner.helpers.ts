/**
 * Split out of `ParticipantStatusRunner.tsx` to stay under the §3.5
 * file-length budget — the pure flag-derivation helpers `useParticipantStatus`
 * (in that file) calls: `deriveParticipantContext`, `deriveParticipantFlags`,
 * `buildStatusObject`, and their own sub-helpers. No React/hooks here.
 */
import { ChatParticipantType, PUBLIC_PROJECT_ID } from '../../model/constants';
import { isParticipantOKForChat } from '../../lib/helpers';
import type { ParticipantStatusFlags } from '../../model/types';

// Helper: derive individual flags (complexity ≤ 12 per function)

function getMcpIsDisconnected(
  isToolkitP: boolean,
  originalDetails: Record<string, unknown> | undefined,
): boolean {
  if (!isToolkitP) return false;
  const isMcp = ((originalDetails?.meta as Record<string, unknown> | undefined)?.mcp as boolean) || false;
  if (!isMcp) return false;
  return !originalDetails?.online;
}

function getSpOAuthLoggedOut(
  sharepointLoggedIn: boolean,
  sharepointLoginSlot: React.ReactNode | undefined,
): boolean {
  if (sharepointLoggedIn) return false;
  return !!sharepointLoginSlot;
}

/** `unknown` -> comparable string, without relying on a possibly-object `toString`. */
function asComparableString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

/**
 * Derives the toolkit/participant type context. `isPubP` uses
 * `asComparableString` (not `===`) so a numeric `project_id` on the wire
 * still matches `PUBLIC_PROJECT_ID` — old-app used loose `==` against a
 * NUMERIC constant for the same reason.
 */
export function deriveParticipantContext(
  entityName: ChatParticipantType | undefined,
  entityMeta: Record<string, unknown> | undefined,
  entitySettings: Record<string, unknown> | undefined,
): { entityName: ChatParticipantType | undefined; isToolkitP: boolean; isPubP: boolean; es: Record<string, unknown> } {
  return {
    entityName,
    isToolkitP: entityName === ChatParticipantType.Toolkits,
    isPubP: asComparableString(entityMeta?.project_id) === PUBLIC_PROJECT_ID,
    es: entitySettings ?? {},
  };
}

// Derives all boolean flags for a participant's status; kept ≤ 12 via sub-helpers.
export function deriveParticipantFlags(
  participant: Record<string, unknown>,
  context: ReturnType<typeof deriveParticipantContext>,
  hasValidationIssue: boolean | undefined,
  getSelectedTools: ((toolType: string | undefined) => string[] | undefined) | undefined,
  isToolkitTypeBlocked: ((toolType: string | undefined) => boolean) | undefined,
  getToolkitTypeLabel: ((toolType: string | undefined) => string) | undefined,
  mcpIsAuthorized: boolean | undefined,
  sharepointLoggedIn: boolean | undefined,
  sharepointLoginSlot: React.ReactNode | undefined,
  hasFetchedDetails: boolean,
  originalDetails: Record<string, unknown> | undefined,
): {
  shouldDisableThisItem: boolean;
  hasMisconfigurationErrors: boolean;
  someToolsAreUnavailable: boolean;
  blockedToolkitNames: string[];
  mcpIsDisconnected: boolean;
  remoteMcpLoggedOut: boolean;
  spOAuthLoggedOut: boolean;
  spOAuthLoggedIn: boolean;
  isPublishedAgentGone: boolean;
  isVersionUnavailable: boolean;
} {
  const { entityName, isToolkitP, isPubP, es } = context;

  const shouldDisableThisItem = !isParticipantOKForChat(participant);
  const hasMisconfigurationErrors = !!hasValidationIssue;
  const someToolsAreUnavailable = getSomeToolsAreUnavailable(entityName, originalDetails, getSelectedTools);
  const blockedToolkitNames = getBlockedToolkitNames(entityName, originalDetails, isToolkitTypeBlocked, getToolkitTypeLabel);
  const remoteMcpLoggedOut = getRemoteMcpLoggedOut(isToolkitP, es, mcpIsAuthorized);
  const effectiveSpLoggedIn = getEffectiveSpLoggedIn(sharepointLoggedIn, sharepointLoginSlot);
  const spOAuthLoggedOut = getSpOAuthLoggedOut(effectiveSpLoggedIn, sharepointLoginSlot);
  const isPublishedAgentGone = getIsPublishedAgentGone(isPubP, hasFetchedDetails, originalDetails);
  const isVersionUnavailable = getIsVersionUnavailable(isPubP, hasFetchedDetails, originalDetails, es);

  return {
    shouldDisableThisItem,
    hasMisconfigurationErrors,
    someToolsAreUnavailable,
    blockedToolkitNames,
    mcpIsDisconnected: getMcpIsDisconnected(isToolkitP, originalDetails),
    remoteMcpLoggedOut,
    spOAuthLoggedOut,
    spOAuthLoggedIn: effectiveSpLoggedIn,
    isPublishedAgentGone,
    isVersionUnavailable,
  };
}

// Sub-helpers for individual flags (each complexity ≤ 5)

// Ported from ParticipantStatusRunner.jsx:83-94: Applications/Pipelines only,
// true if any tool's `selected_tools` has an entry missing from that tool
// TYPE's schema-derived available list. No slot -> stays `false`.
function getSomeToolsAreUnavailable(
  entityName: ChatParticipantType | undefined,
  originalDetails: Record<string, unknown> | undefined,
  getSelectedTools: ((toolType: string | undefined) => string[] | undefined) | undefined,
): boolean {
  if (entityName !== ChatParticipantType.Applications && entityName !== ChatParticipantType.Pipelines) return false;
  if (!getSelectedTools) return false;
  const tools = ((originalDetails?.version_details as Record<string, unknown> | undefined)?.tools as Record<string, unknown>[] | undefined) ?? [];
  return tools.some((tool) => {
    const availableTools = getSelectedTools(tool?.type as string | undefined);
    const selectedTools = (tool?.settings as Record<string, unknown> | undefined)?.selected_tools as unknown[] | undefined;
    return !!availableTools?.length && !!selectedTools?.some((item) => !availableTools.includes(item as string));
  });
}

// Ported from ParticipantStatusRunner.jsx:96-109: blocked toolkit TYPE labels
// (not instance names), Applications/Pipelines only. No slot -> stays `[]`.
function getBlockedToolkitNames(
  entityName: ChatParticipantType | undefined,
  originalDetails: Record<string, unknown> | undefined,
  isToolkitTypeBlocked: ((toolType: string | undefined) => boolean) | undefined,
  getToolkitTypeLabel: ((toolType: string | undefined) => string) | undefined,
): string[] {
  if (entityName !== ChatParticipantType.Applications && entityName !== ChatParticipantType.Pipelines) return [];
  if (!isToolkitTypeBlocked || !getToolkitTypeLabel) return [];
  const tools = ((originalDetails?.version_details as Record<string, unknown> | undefined)?.tools as Record<string, unknown>[] | undefined) ?? [];
  const labels = tools
    .filter((tool) => tool?.type !== 'application' && isToolkitTypeBlocked(tool?.type as string | undefined))
    .map((tool) => getToolkitTypeLabel(tool?.type as string | undefined));
  return [...new Set(labels)];
}

function getEffectiveSpLoggedIn(
  sharepointLoggedIn: boolean | undefined,
  sharepointLoginSlot: React.ReactNode | undefined,
): boolean {
  return sharepointLoggedIn ?? (sharepointLoginSlot ? true : false);
}

function getRemoteMcpLoggedOut(
  isToolkitP: boolean,
  es: Record<string, unknown>,
  mcpIsAuthorized: boolean | undefined,
): boolean {
  return isToolkitP && es.toolkit_type === 'mcp' && !mcpIsAuthorized;
}

function getIsPublishedAgentGone(
  isPubP: boolean,
  hasFetchedDetails: boolean,
  originalDetails: Record<string, unknown> | undefined,
): boolean {
  return isPubP && hasFetchedDetails && !(originalDetails?.versions as unknown[] | undefined)?.length;
}

function getIsVersionUnavailable(
  isPubP: boolean,
  hasFetchedDetails: boolean,
  originalDetails: Record<string, unknown> | undefined,
  es: Record<string, unknown>,
): boolean {
  const versions = originalDetails?.versions as Record<string, unknown>[] | undefined;
  return isPubP &&
    hasFetchedDetails &&
    !!versions?.length &&
    !versions.some((v) => v.id === es.version_id);
}

// Assembles the full `ParticipantStatusFlags` object from pre-computed flags + shared props.
export function buildStatusObject(
  flags: ReturnType<typeof deriveParticipantFlags>,
  mcpIsAuthorized: boolean | undefined,
  sharepointConfig: unknown,
): ParticipantStatusFlags {
  return {
    hasError: flags.shouldDisableThisItem ||
      flags.hasMisconfigurationErrors ||
      flags.mcpIsDisconnected ||
      flags.remoteMcpLoggedOut ||
      flags.spOAuthLoggedOut ||
      flags.someToolsAreUnavailable ||
      flags.blockedToolkitNames.length > 0 ||
      flags.isPublishedAgentGone ||
      flags.isVersionUnavailable,
    shouldDisableThisItem: flags.shouldDisableThisItem,
    hasMisconfigurationErrors: flags.hasMisconfigurationErrors,
    someToolsAreUnavailable: flags.someToolsAreUnavailable,
    blockedToolkitNames: flags.blockedToolkitNames,
    isPublishedAgentGone: flags.isPublishedAgentGone,
    isVersionUnavailable: flags.isVersionUnavailable,
    mcpIsDisconnected: flags.mcpIsDisconnected,
    remoteMcpLoggedOut: flags.remoteMcpLoggedOut,
    hasRemoteMcpLoggedIn: !!mcpIsAuthorized,
    spOAuthLoggedOut: flags.spOAuthLoggedOut,
    spOAuthLoggedIn: flags.spOAuthLoggedIn,
    spConfig: sharepointConfig ?? null,
  };
}
