/**
 * Entity types for chat participants — mirrors `ChatParticipantType` from
 * the old app's `common/constants`, but exported as string literals so
 * callers don't need to import that constant (avoiding a cross-feature
 * dependency if `common/constants` ever moves).
 *
 * **Known duplication, not resolved here**: `@/shared/lib/chat` (unit S3)
 * already exports its own correct `ChatParticipantType` with the same
 * 6 overlapping keys — this feature reinvented its own copy instead of
 * importing that one, and the reinvention had the wrong (plural) values
 * for `Users`/`Models`/`Applications`/`Pipelines` until the wave-2 C5
 * adversarial-review fix that corrected them here. A future pass should
 * consider importing `ChatParticipantType` from `@/shared/lib/chat` and
 * keeping only this file's genuinely extra values (`Tools`/`Attachments`/
 * `MCP`, which the shared constant doesn't have) locally — out of scope
 * for this fix, which only corrects the wrong values in place.
 */

/** Public/shared project id — mirrors old-app `common/constants:PUBLIC_PROJECT_ID`. */
const VITE_PUBLIC_PROJECT_ID = import.meta.env.VITE_PUBLIC_PROJECT_ID ?? '';
export const PUBLIC_PROJECT_ID = VITE_PUBLIC_PROJECT_ID || '0';

/**
 * Wire values ported from old-app `common/constants.js:950-958`
 * (`ChatParticipantType`). `Users`/`Models`/`Applications`/`Pipelines` were
 * previously wrong here (plural — `'users'`/`'models'`/`'applications'`/
 * `'pipelines'`) — a real, confirmed regression: every `entity_name`
 * comparison against these constants throughout this feature (participant
 * grouping, active-participant matching, permission-map lookups) silently
 * never matched real wire data. `Toolkits`/`Dummy` were already correct.
 * `Tools`/`Attachments`/`MCP` have no old-app `ChatParticipantType`
 * counterpart (the old app used separate ad hoc checks for those) — left
 * as-is, not part of this fix.
 */
export const ChatParticipantType = {
  Users: 'user',
  Toolkits: 'toolkit',
  Tools: 'tools',
  Models: 'llm',
  Applications: 'application',
  Pipelines: 'pipeline',
  Attachments: 'attachments',
  Dummy: 'dummy',
  MCP: 'mcp',
} as const;

export type ChatParticipantType = (typeof ChatParticipantType)[keyof typeof ChatParticipantType];

/** Participant entity name values we recognise as valid chat participants. */
export const ValidParticipantEntityNames = [
  ChatParticipantType.Users,
  ChatParticipantType.Toolkits,
  ChatParticipantType.Applications,
  ChatParticipantType.Pipelines,
] as const;

export type ValidParticipantEntityName = (typeof ValidParticipantEntityNames)[number];

/** Participant types that can be made active in a chat (users + entities with LLM). */
export const ActiveParticipantEntityNames = [
  ChatParticipantType.Users,
  ChatParticipantType.Applications,
  ChatParticipantType.Pipelines,
] as const;

export type ActiveParticipantEntityName = (typeof ActiveParticipantEntityNames)[number];

/** Permission keys used by the old app for participant creation/editing. */
export const PERMISSIONS = {
  applications: { create: 'applications.create', update: 'applications.update' },
  toolkits: { create: 'toolkits.create', update: 'toolkits.update' },
} as const;

/**
 * Mapping of participant entity type → creation permission required.
 * Ported from `participant.constants.js:10-14`.
 */
export const ParticipantCreationPermissionMap: Record<string, string> = {
  agent: PERMISSIONS.applications.create,
  application: PERMISSIONS.applications.create,
  pipeline: PERMISSIONS.applications.create,
  toolkit: PERMISSIONS.toolkits.create,
  mcp: PERMISSIONS.toolkits.create,
};

/**
 * Mapping of participant entity name → edit permission required.
 * Ported from `participant.constants.js:16-19`.
 */
export const ParticipantEditPermissionMap: Record<string, string> = {
  applications: PERMISSIONS.applications.update,
  pipelines: PERMISSIONS.applications.update,
  toolkits: PERMISSIONS.toolkits.update,
};

/**
 * Allowed tools for attachment participants — restricts which tools are
 * available when a toolkit is used as an attachment manager.
 * Ported from `participant.constants.js:25-38`.
 */
export const ATTACHMENT_ALLOWED_TOOLS = [
  'index_data',
  'search_index',
  'stepback_search_index',
  'stepback_summary_index',
  'listFiles',
  'createFile',
  'readFile',
  'appendData',
  'overwriteData',
  'read_file_chunk',
  'read_multiple_files',
  'search_file',
  'edit_file',
] as const;

export type AttachmentAllowedTool = (typeof ATTACHMENT_ALLOWED_TOOLS)[number];

/**
 * Default/empty icon metadata shape returned when a participant has no
 * custom icon.  Ported from `useParticipantEntityIcon.hooks.js:14`
 * (the `entity_settings?.icon_meta || icon_meta || version_details?.icon_meta`
 * fallback chain).
 */
export interface ParticipantIconMeta {
  readonly component?: React.ReactNode | undefined;
  readonly url?: string | undefined;
}
