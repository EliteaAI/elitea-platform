/**
 * Pure derivations extracted from `pages/NewChat/AgentEditor.jsx`'s
 * top-level component body (lines 128-143) so `ui/AgentEditor.tsx` can stay
 * under the §3.5 per-function complexity budget and so this logic is
 * directly unit-testable without mounting the whole editor.
 */

export const PUBLIC_PROJECT_ID = 'public';

export interface AgentEditorAgentLike {
  readonly id?: string | number;
  readonly entity_meta?: { readonly id?: string | number; readonly project_id?: string | number };
  readonly entity_settings?: { readonly version_id?: string | number };
  readonly meta?: { readonly id?: string | number; readonly name?: string };
  readonly name?: string;
}

/** `getAgentId` — `agent?.entity_meta?.id || agent?.id || agent?.meta?.id` — `AgentEditor.jsx:25-28`. */
export function agentId(agent: AgentEditorAgentLike | null | undefined): string | number | undefined {
  return agent?.entity_meta?.id || agent?.id || agent?.meta?.id;
}

/** `agent?.entity_meta?.project_id === PUBLIC_PROJECT_ID` — `AgentEditor.jsx:132`. */
export function isPublicAgent(agent: AgentEditorAgentLike | null | undefined): boolean {
  return agent?.entity_meta?.project_id === PUBLIC_PROJECT_ID;
}

/** `!isPublic && hasEditPermission` — `AgentEditor.jsx:133`. */
export function canEditAgent(isPublic: boolean, hasEditPermission: boolean): boolean {
  return !isPublic && hasEditPermission;
}

/** The baseline's `ViewMode.Owner`/`ViewMode.Public` string literals (`common/constants.js`) — `AgentEditor.jsx:134`. */
export function agentViewMode(canEditIt: boolean): 'Owner' | 'Public' {
  return canEditIt ? 'Owner' : 'Public';
}

/** `agent?.meta?.name || agent?.name || fallback` — the editor title/name-fallback chain used at `AgentEditor.jsx:200,235,312`. */
export function agentDisplayName(agent: AgentEditorAgentLike | null | undefined, fallback = ''): string {
  return agent?.meta?.name || agent?.name || fallback;
}
