/**
 * Chat-domain constants and pure selectors ported from
 * apps/elitea-ui/src/common/{utils.jsx,constants.js} (unit S3, spec §9.3).
 *
 * These are conceptually entities/chat domain code (participant/conversation/
 * folder shapes) — spec §9.3 gives unit E1 `src/entities/**` with exactly
 * "pure selectors for: conversation, folder, participant" in its brief. S3
 * cannot write outside `shared/lib/**` (its OWNS boundary), so this lands
 * here for now; flagged for E1 to re-home (re-export or move) when it lands.
 */

/** `constants.js:950-958`. */
export const ChatParticipantType = {
  Applications: 'application',
  Toolkits: 'toolkit',
  Models: 'llm',
  Users: 'user',
  Pipelines: 'pipeline',
  Skills: 'skill',
  Dummy: 'dummy',
} as const;

/** @public Wave-1 surface: type-only, for Wave-2 chat features to type participant discriminants against. */
export type ChatParticipantTypeValue = (typeof ChatParticipantType)[keyof typeof ChatParticipantType];

export interface RawParticipantLike {
  readonly agent_type?: string;
  readonly participantType?: string;
  readonly model_name?: string;
  readonly integration_uid?: string;
  readonly id?: string | number;
  readonly project_id?: string | number;
}

/**
 * Composite `type_id_projectId` key used to identify a chat participant
 * across re-renders. Model participants key on `model_name-integration_uid`
 * instead of `id` (old-app `utils.jsx:887-904`).
 */
export function getRawParticipantUniqueId(participant?: RawParticipantLike | null): string {
  if (!participant) return '';
  const participantType =
    participant.agent_type === ChatParticipantType.Pipelines
      ? ChatParticipantType.Pipelines
      : participant.participantType;
  const idPart =
    participant.participantType === ChatParticipantType.Models
      ? `${participant.model_name}-${participant.integration_uid}`
      : participant.id;
  return `${participantType}_${idPart}_${participant.project_id || ''}`;
}

export interface ConversationLike {
  readonly id?: string | number;
  readonly isPlayback?: unknown;
}

/** Two conversations are "the same" iff `id` matches AND playback-ness matches. */
export function areTheSameConversations(
  conversation1?: ConversationLike | null,
  conversation2?: ConversationLike | null,
): boolean {
  if (conversation1 && conversation2) {
    return conversation1.id === conversation2.id && !!conversation1.isPlayback === !!conversation2.isPlayback;
  }
  return false;
}

export interface FolderLike {
  readonly id?: string | number;
}

export function areTheSameFolders(folder1?: FolderLike | null, folder2?: FolderLike | null): boolean {
  if (folder1 && folder2) {
    return folder1.id === folder2.id;
  }
  return false;
}

/** React-key-style id incorporating playback state. */
export function genConversationId(conversation?: ConversationLike | null): string {
  return `${String(conversation?.id)}_isPlayback_${String(conversation?.isPlayback)}`;
}

/** `utils.jsx:1023-1024` — default empty shapes for a new conversation/folder. */
export const dummyConversation = {
  name: '',
  chat_history: [] as unknown[],
  participants: [] as unknown[],
  is_private: true,
} as const;

export const dummyFolder = {
  name: '',
  conversations: [] as unknown[],
} as const;

/** `constants.js:1026-1027` — canvas collaborative-editing pseudo-users. */
export const CANVAS_ADMIN_USER = 'admin@centry.user';
export const CANVAS_SYSTEM_USER = 'system@centry.user';

/** `constants.js:1067-1073`. */
export const TOOL_ACTION_TYPES = {
  Summary: 'summary',
  Toolkit: 'toolkit',
  Tool: 'tool',
  Llm: 'llm',
  SwarmChild: 'swarm_child',
} as const;

/**
 * `constants.js:1075-1081`. User-visible copy — candidate for extraction
 * into `shared/i18n/en.json` (unit S8, R-T3); ported verbatim as a parity
 * floor until S8 lands (see S3 report).
 */
export const TOOL_ACTION_NAMES = {
  Summary: 'Summarizing the chat history',
  Toolkit: 'Toolkit thinking step',
  Tool: 'tool',
  Llm: 'Thinking step',
  SwarmChild: 'Sub-agent response',
} as const;

/** `constants.js:938-944`. */
export const ToolActionStatus = {
  complete: 'complete',
  error: 'error',
  actionRequired: 'action_required',
  cancelled: 'cancelled',
  processing: 'processing',
} as const;
