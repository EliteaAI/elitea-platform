/**
 * Shared types for `useSlashCommandHandler`'s port of
 * `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useSlashCommandHandler.hooks.js` (609 lines — split across this file plus
 * `useSlashCommandHandler.helpers.ts`/`.idlePhase.ts`/`.toolPhase.ts`/`.ts`
 * purely to stay under this codebase's `max-lines`(400)/`complexity`(12)
 * budgets; no behaviour differs from a single-file port).
 *
 * **Field-naming deviation (disclosed):** the baseline's `committedMentions`
 * entries use snake_case (`toolkit_id`/`project_id`/`toolkit_name`/
 * `toolkit_type`/`toolkit_settings`/`tool_name`) because they are spread
 * more or less directly into the socket `emit` payload's `mentioned_toolkits`
 * field. In this app, `SOCKET_EVENTS.chat_predict.emitSchema` is a
 * `z.looseObject` with no declared `mentioned_toolkits` shape (see
 * `shared/api/socket/events.ts`) — the wire mapping is therefore entirely
 * the composition root's (a future C6 unit's) responsibility, not
 * something this feature can or should pre-shape. Given that, this port
 * uses camelCase field names throughout (`toolkitId`/`projectId`/
 * `toolkitName`/`toolkitType`/`toolkitSettings`/`toolName`), matching every
 * other domain type in this app, and leaves the snake_case wire mapping to
 * whichever unit actually builds the emit payload.
 */
import type { KeyboardEvent } from 'react';

/** `'idle' | 'toolkit' | 'tool'` — the baseline's own three phase strings, ported verbatim (a local union, unrelated to `../constants/mention.constants.ts`'s `MentionPhase`, which the baseline's own `useSlashCommandHandler.hooks.js` never imports). */
export type SlashPhase = 'idle' | 'toolkit' | 'tool';

/** A toolkit reference as carried by `selectedToolkit`/`lastToolkitRef` — `{id, project_id, name, type, settings}` in the baseline. */
export interface SlashToolkitRef {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly type: string;
  readonly settings?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * One committed "/" mention — `mentioned_toolkits` payload shape in the
 * baseline (see this file's header for the camelCase field-naming
 * deviation). `toolName: null` means "the whole toolkit was mentioned, no
 * specific tool" (the baseline's own convention, preserved).
 */
export interface CommittedToolkitMention {
  readonly toolkitId: string;
  readonly projectId: string;
  readonly toolkitName: string;
  readonly toolkitType: string;
  readonly toolkitSettings?: Readonly<Record<string, unknown>> | undefined;
  readonly toolName: string | null;
}

/**
 * Mutable refs shared across every phase-handler function — the baseline's
 * own `phaseRef`/`pendingToolQueryRef`/`lastToolkitRef`/`committedMentionsRef`/
 * `mentionAnchorRef`, bundled into one context object so they can be
 * threaded through the split-out `idlePhase.ts`/`toolPhase.ts` helper
 * functions without an unwieldy positional-argument list. Not exported
 * beyond this module (knip: no outside consumer by name) — only reachable
 * as `SlashHandlerContext['refs']` below.
 */
interface SlashHandlerRefs {
  phaseCurrent: SlashPhase;
  pendingToolQuery: string;
  lastToolkit: SlashToolkitRef | null;
  committedMentions: readonly CommittedToolkitMention[];
  mentionAnchor: number | null;
  activeIndex: number;
}

/** The subset of the hook's `useState` setters every phase-handler function needs — bundled for the same reason as `SlashHandlerRefs`. Not exported beyond this module — same rationale. */
interface SlashHandlerSetters {
  readonly setPhase: (phase: SlashPhase) => void;
  readonly setToolkitQuery: (query: string) => void;
  readonly setToolQuery: (query: string) => void;
  readonly setSelectedToolkit: (toolkit: SlashToolkitRef | null) => void;
  readonly setIsQueryFinal: (isFinal: boolean) => void;
  readonly setCommittedMentions: (updater: (prev: readonly CommittedToolkitMention[]) => readonly CommittedToolkitMention[]) => void;
  readonly setActiveIndex: (index: number) => void;
}

/** One `refs`+`setters` bundle, threaded through every phase-handler function in `.idlePhase.ts`/`.toolPhase.ts`. `refs` is a plain mutable object (not `MutableRefObject<T>`) so its fields can be read/written directly (`ctx.refs.phaseCurrent = 'toolkit'`) — the hook itself owns the actual `useRef` box and copies `.current` in/out around each call. */
export interface SlashHandlerContext {
  readonly refs: SlashHandlerRefs;
  readonly setters: SlashHandlerSetters;
}

/**
 * `textToCursor.match(/\/([^/\s]+)\/([^/\s]*)$/)` (the baseline's own
 * `fullMatch`), pre-parsed into named fields once by `syncWithValue`'s
 * dispatcher so the phase-resolver functions below never touch a
 * `noUncheckedIndexedAccess`-typed `RegExpMatchArray` directly.
 */
export interface SlashFullMatch {
  readonly raw: string;
  readonly toolkitName: string;
  readonly toolQuery: string;
}

/** `textToCursor.match(/\/([^/\s]*)$/)` (the baseline's own `toolkitOnlyMatch`), pre-parsed — see `SlashFullMatch`. */
export interface SlashToolkitOnlyMatch {
  readonly raw: string;
  readonly toolkitName: string;
}

export interface UseSlashCommandHandlerParams {
  /** Mirrors the baseline's `setInputContent` param — called (with `''`) by `clearMentions()` after a successful send. Optional because a caller with no separate input-content mirror (e.g. one relying entirely on `useSlashMention`'s own `inputContent` state) can omit it, matching the baseline's `setInputContent?.('')` optional-call. */
  readonly setInputContent?: ((value: string) => void) | undefined;
}

export interface UseSlashCommandHandlerResult {
  readonly phase: SlashPhase;
  readonly toolkitQuery: string;
  readonly toolQuery: string;
  readonly selectedToolkit: SlashToolkitRef | null;
  readonly committedMentions: readonly CommittedToolkitMention[];
  readonly isQueryFinal: boolean;
  readonly onKeyDown: (event: KeyboardEvent) => void;
  readonly syncWithValue: (text: string, cursorPos?: number | null) => void;
  readonly selectToolkit: (toolkit: SlashToolkitRef) => void;
  readonly commitMention: (toolName?: string | null) => void;
  readonly removeMention: (index: number) => void;
  readonly clearMentions: () => void;
  readonly resetSlash: () => void;
  readonly mentionAnchorRef: { current: number | null };
  readonly activeIndex: number;
  readonly setActiveIndex: (index: number) => void;
  readonly itemCountRef: { current: number };
  readonly onConfirmActiveRef: { current: ((index: number) => void) | null };
}
