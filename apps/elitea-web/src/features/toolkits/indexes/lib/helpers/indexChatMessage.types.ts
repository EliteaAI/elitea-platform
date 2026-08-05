/**
 * Shared message/tool-action shapes for the index test-chat panel (unit
 * A4a) — split into this dedicated types-only file so `indexChat.helpers.ts`
 * and `indexChatReducer.local.ts` can each depend on the SAME shape
 * without depending on each other. Both files need `IndexChatMessage`; a
 * plain `import type {IndexChatMessage} from './indexChat.helpers'` inside
 * `indexChatReducer.local.ts` — combined with `indexChat.helpers.ts`
 * re-exporting `generateChatMessageBasedOnResponse` FROM
 * `indexChatReducer.local.ts` (so `features/toolkits/lib/hooks/
 * useToolkitChat*.hooks.ts`, unit A4b, keeps importing it from the same
 * path it always has) — is a genuine circular module dependency
 * (`depcruise`'s `no-cycle` rule caught exactly this on the first
 * attempt, regardless of the import being type-only: the module graph
 * edge exists either way). This file breaks that cycle: both
 * `indexChat.helpers.ts` and `indexChatReducer.local.ts` import FROM here;
 * neither imports FROM the other.
 */

/** A single chat message, loosely typed to match this domain's historically mixed shape (mirrors `entities/message`'s deliberately loose `ToolAction`). */
export interface IndexChatMessage {
  id: string;
  role: string;
  content: string;
  created_at: number;
  participant_id: string;
  isLoading?: boolean | undefined;
  isStreaming?: boolean | undefined;
  task_id?: string | undefined;
  toolActions?: IndexToolAction[] | undefined;
  exception?: unknown;
}

/** Not exported — every consumer reaches this only structurally, through `IndexChatMessage.toolActions` (confirmed: `npx knip` flags it as an unused export otherwise, since nothing imports it by name). */
interface IndexToolAction {
  name?: string | undefined;
  id?: string | undefined;
  status: string;
  toolInputs?: unknown;
  toolOutputs?: unknown;
  toolMeta?: Record<string, unknown> | undefined;
  created_at: unknown;
  ended_at?: unknown;
  type: string;
  content?: string | undefined;
  execution_time_seconds?: number | undefined;
}
