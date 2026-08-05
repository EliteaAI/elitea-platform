/**
 * Agent Hub types — shared interfaces for the agents-hub cluster.
 *
 * @public Wave-2 unit A13 surface.
 */
import type { PublicApplicationSummary } from '@/shared/api/generated/model';

import { LikeUpdateStrategy } from './constants';

/* ── Application shape (extends generated type with hub-specific fields) ─ */

export interface ApplicationData extends PublicApplicationSummary {
  category?: string;
  is_liked?: boolean;
  likes?: number;
  authors?: AuthorData[];
  author?: AuthorData;
  icon_meta?: Record<string, unknown> | null;
  version_details?: VersionDetails;
  welcome_message?: string;
  conversation_starters?: string[];
}

export interface AuthorData {
  id: string;
  name: string;
  username?: string;
}

interface VersionDetails {
  id: string;
  author?: AuthorData;
  icon_meta?: Record<string, unknown> | null;
  welcome_message?: string;
  conversation_starters?: string[];
  instructions?: string;
  llm_settings?: Record<string, unknown>;
  agent_type?: string;
  variables?: Record<string, unknown>;
}

/* ── Strategy enum ────────────────────────────────────────────────────── */

export type LikeUpdateStrategyValue = (typeof LikeUpdateStrategy)[keyof typeof LikeUpdateStrategy];
