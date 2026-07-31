// @ts-nocheck
import { ChatParticipantType } from './constants';

// ---------------------------------------------------------------------------
// Helper types for `transformParticipant` output
// ---------------------------------------------------------------------------

export interface TransformedParticipantEntityMeta {
  id?: string;
  name?: string;
  project_id?: string;
  integration_uid?: string;
  model_name?: string;
}

export interface TransformedParticipantEntitySettings {
  variables?: unknown[];
  icon_meta?: Record<string, unknown>;
  toolkit_type?: string;
  agent_type?: string;
  version_id?: string;
  mcp_server_url?: string;
  llm_settings?: Record<string, unknown>;
  max_tokens?: number;
  temperature?: number;
  reasoning_effort?: string;
}

export interface TransformedParticipant {
  entity_name: ChatParticipantType;
  entity_meta: TransformedParticipantEntityMeta;
  entity_settings: TransformedParticipantEntitySettings;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Old-app participant wire shapes (the raw shape coming from useParticipants)
// ---------------------------------------------------------------------------

/** Minimal representation of a participant item from the old-app candidate list. */
export interface OldAppParticipant {
  id?: string;
  participantType?: ChatParticipantType;
  entity_name?: ChatParticipantType;
  entity_meta?: Record<string, unknown>;
  entity_settings?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  agent_type?: string;
  version_details?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  type?: string;
  model_name?: string;
  integration_uid?: string;
  max_tokens?: number;
  temperature?: number;
  reasoning_effort?: string;
  [key: string]: unknown;
}

/**
 * Models data from the ListModels endpoint (used for default LLM model resolution).
 */
export interface ModelItem {
  name?: string;
  project_id?: string;
  default?: boolean;
  [key: string]: unknown;
}

export interface ModelsResponse {
  items: ModelItem[];
  total: number;
}

// ---------------------------------------------------------------------------
// ParticipantDetailsContext shape
// ---------------------------------------------------------------------------

export interface ParticipantDetailCacheKey {
  type: ChatParticipantType;
  id: string;
  projectId: string;
}

export interface ParticipantStatusFlags {
  hasError: boolean;
  shouldDisableThisItem: boolean;
  hasMisconfigurationErrors: boolean;
  someToolsAreUnavailable: boolean;
  blockedToolkitNames: string[];
  isPublishedAgentGone: boolean;
  isVersionUnavailable: boolean;
  mcpIsDisconnected: boolean;
  remoteMcpLoggedOut: boolean;
  hasRemoteMcpLoggedIn: boolean;
  spOAuthLoggedOut: boolean;
  spOAuthLoggedIn: boolean;
  spConfig: unknown | null;
}

export interface ParticipantDetailsContextValue {
  readonly getDetails: (type: ChatParticipantType, id: string, projectId: string) => Record<string, unknown>;
  readonly hasFetched: (type: ChatParticipantType, id: string, projectId: string) => boolean;
  readonly updateDetails: (
    type: ChatParticipantType,
    id: string,
    projectId: string,
    updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>),
  ) => void;
  readonly refetchDetails: (type: ChatParticipantType, id: string, projectId: string) => Promise<Record<string, unknown>>;
  readonly getParticipantStatus: (
    type: ChatParticipantType,
    id: string,
    projectId: string,
  ) => ParticipantStatusFlags;
  readonly hasParticipantError: (type: ChatParticipantType, id: string, projectId: string) => boolean;
}
