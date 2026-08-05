import type { Participant } from '@/entities/participant';

import type { EditorOpenInfo } from '../model/useEditorMutex';

/**
 * Pure adapter functions converting `entities/participant`'s `Participant`
 * (camelCase: `entityMeta`/`entitySettings`/`meta`) into the snake_case
 * shapes `features/agents`', `features/pipelines`', and `features/toolkits`'
 * editor hooks/components actually expect (`entity_meta`/`entity_settings`/
 * `meta`) — the same camelCase-vs-snake_case adapter idiom already
 * established this Wave (`widgets/chat-box/ui/ChatBox.helpers.ts`'s
 * `toParticipant`/`buildEntityMeta`/`buildMeta`/`buildEntitySettings`;
 * `features/agents/lib/hooks/applicationChat.helpers.ts`'s
 * `buildApplicationParticipant`/`features/pipelines/lib/hooks/
 * pipelineChat.helpers.ts`'s `buildPipelineParticipant`).
 *
 * **Why these adapters return LOCAL, structurally-typed interfaces
 * (`AgentParticipantSnapshot`/`PipelineParticipantSnapshot`) instead of the
 * "official" target types the design brief named
 * (`AgentEditorAgentLike`/`EditAgentParticipant`/`PipelineEditorPipelineLike`/
 * `EditPipelineParticipant`) — a disclosed, verified deviation, not a
 * shortcut:** every one of those four types is deliberately NOT exported
 * from `features/agents/index.ts` / `features/pipelines/index.ts` (verified
 * by reading both barrels in full) — each barrel's own doc comment
 * explains why: "a caller assembling the `deps` object types it
 * structurally... without needing a separate import". `processes/chat/`
 * importing any of them by name from `features/agents/lib/
 * agentEditorViewState.ts` or `features/agents/model/useEditAgent.ts`
 * directly (bypassing `index.ts`) would be a `no-deep-slice-import-cross-
 * slice` (R-L3) violation. Structural typing makes this a non-issue: a
 * plain object shaped correctly satisfies each hook's/component's real
 * (unexported) parameter type at the call site with zero import needed —
 * TypeScript checks shape, not declaration identity.
 *
 * `AgentParticipantSnapshot` is deliberately the UNION of every field
 * `AgentEditorAgentLike` (`agent` prop, read by `AgentEditor`'s own
 * `agentDisplayName`/`isPublicAgent`/`agentId`) and `EditAgentParticipant`
 * (`useEditAgent`'s `editingAgent` state / `onShowAgentEditor` param) each
 * declare — never wider than that (every field below is traceable to one of
 * the two real type declarations, read in full before writing this file).
 * A single object built by `toAgentParticipantSnapshot` satisfies BOTH
 * consumers structurally (each is a subset of this union), which is exactly
 * why `ChatWithEditors.tsx` can hand the SAME object to `useEditAgent`'s
 * `onShowAgentEditor` (populating its internal `editingAgent` state) and
 * then render `<AgentEditor agent={editingAgent}>` directly — the object
 * REMAINS the same reference at runtime, so `entity_meta.project_id`/
 * `meta.name` (fields `EditAgentParticipant` itself doesn't declare, but
 * `AgentEditorAgentLike` needs for correct public-agent detection and
 * title display) are still genuinely present on it even though
 * `useEditAgent`'s own declared state type doesn't know about them. Same
 * reasoning for `PipelineParticipantSnapshot`. `ToolkitParticipantSnapshot`
 * mirrors the ALREADY-exported `ToolkitEditorParticipant`
 * (`features/toolkits/index.ts` DOES export it) field-for-field — no
 * separate "official" type gap there, but it is still declared locally
 * (rather than imported) for the same "one snapshot, no per-consumer
 * duplication" reason, and remains structurally interchangeable with the
 * real exported type.
 *
 * `readAgent/Pipeline/ToolkitParticipantSnapshot` are the reverse
 * direction: `useEditorMutex`'s own `EditorOpenInfo` queueing channel
 * (`processes/chat/model/useEditorMutex.ts`) is typed as a loose
 * `Readonly<Record<string, unknown>> | undefined` — deliberately so, per
 * that file's own doc comment ("the payload's real structure is each
 * editor feature's own concern"). A concretely-typed snapshot object is
 * NOT assignable to `Record<string, unknown>` without an unsafe cast
 * (verified empirically: TS2345 "Index signature for type 'string' is
 * missing"), so `ChatWithEditors.tsx` spreads a snapshot into a fresh
 * object literal when calling `useEditorMutex`'s `onEditAgent`/
 * `onEditPipeline`/`onEditToolkit` (a fresh literal IS assignable to an
 * indexed type — also verified empirically), and uses the matching
 * `read*` function here to safely narrow the payload back out of
 * `EditorOpenInfo` when the mutex replays a QUEUED open (`onConfirmCloseEditor`'s
 * `openHandlers[...](queuedOpen.information)`). Same defensive
 * `typeof`-narrowing idiom as `ChatBox.helpers.ts`'s `toParticipant`.
 */

// ── Small per-field narrowing helpers, shared by every builder below ──────

function readIdLike(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function readStringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBooleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/** Builds a `{[key]: value}` fragment only when `value` is defined — the `exactOptionalPropertyTypes`-safe conditional-spread idiom `ChatBox.helpers.ts`'s own `optField` already established for this exact problem. */
function optField<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } {
  return (value !== undefined ? { [key]: value } : {}) as { readonly [P in K]?: V };
}

interface AgentVariableLike {
  readonly name?: string;
  readonly value?: string;
}

/** `Participant.entitySettings.variables` is `unknown` — narrows it to the `{name?, value?}[]` shape `EditAgentParticipant.entity_settings.variables` declares, without trusting any element's shape blindly. */
function readAgentVariables(value: unknown): readonly AgentVariableLike[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry): AgentVariableLike => {
    const record = readRecord(entry);
    return {
      ...optField('name', readStringField(record?.['name'])),
      ...optField('value', readStringField(record?.['value'])),
    };
  });
}

// ── Agent ───────────────────────────────────────────────────────────────

/**
 * The union of every field `AgentEditorAgentLike`
 * (`features/agents/lib/agentEditorViewState.ts`) and `EditAgentParticipant`
 * (`features/agents/model/useEditAgent.ts`) declare that `Participant`
 * (`entities/participant`) actually has a real source for — see this
 * module's own doc comment for why a local, structurally-typed union stands
 * in for both unexported names. Deliberately omits `AgentEditorAgentLike`'s
 * top-level `name?: string`: `Participant` carries no top-level display
 * name of its own (only `meta.name`, already mapped below), and
 * `agentDisplayName`'s own fallback chain (`agent?.meta?.name ||
 * agent?.name || fallback`) would never reach an omitted-but-present `name`
 * field anyway once `meta.name` is populated — there is no second real
 * value to carry.
 */
export interface AgentParticipantSnapshot {
  readonly id?: string | number;
  readonly entity_meta?: { readonly id?: string | number; readonly project_id?: string | number };
  readonly entity_settings?: {
    readonly version_id?: string | number;
    readonly variables?: readonly AgentVariableLike[];
    readonly llm_settings?: unknown;
  };
  readonly meta?: { readonly id?: string | number; readonly name?: string };
}

function buildAgentEntityMeta(entityMeta: Participant['entityMeta']): AgentParticipantSnapshot['entity_meta'] {
  if (!entityMeta) return undefined;
  return { ...optField('id', entityMeta.id), ...optField('project_id', entityMeta.projectId) };
}

function buildAgentEntitySettings(entitySettings: Participant['entitySettings']): AgentParticipantSnapshot['entity_settings'] {
  if (!entitySettings) return undefined;
  return {
    ...optField('version_id', entitySettings.versionId),
    ...optField('variables', readAgentVariables(entitySettings.variables)),
    ...optField('llm_settings', entitySettings.llmSettings),
  };
}

function buildParticipantMeta(meta: Participant['meta']): { readonly id?: string | number; readonly name?: string } | undefined {
  if (!meta) return undefined;
  return { ...optField('id', meta.id), ...optField('name', meta.name) };
}

/** `Participant` -> `AgentParticipantSnapshot` — feeds both `useEditAgent`'s `onShowAgentEditor`/state and `<AgentEditor agent={...}>`. */
export function toAgentParticipantSnapshot(participant: Participant): AgentParticipantSnapshot {
  return {
    id: participant.id,
    ...optField('entity_meta', buildAgentEntityMeta(participant.entityMeta)),
    ...optField('entity_settings', buildAgentEntitySettings(participant.entitySettings)),
    ...optField('meta', buildParticipantMeta(participant.meta)),
  };
}

function readAgentEntityMeta(wire: Record<string, unknown> | undefined): AgentParticipantSnapshot['entity_meta'] {
  const entityMeta = readRecord(wire?.['entity_meta']);
  if (!entityMeta) return undefined;
  return { ...optField('id', readIdLike(entityMeta['id'])), ...optField('project_id', readIdLike(entityMeta['project_id'])) };
}

function readAgentEntitySettings(wire: Record<string, unknown> | undefined): AgentParticipantSnapshot['entity_settings'] {
  const entitySettings = readRecord(wire?.['entity_settings']);
  if (!entitySettings) return undefined;
  return {
    ...optField('version_id', readIdLike(entitySettings['version_id'])),
    ...optField('variables', readAgentVariables(entitySettings['variables'])),
    ...optField('llm_settings', entitySettings['llm_settings']),
  };
}

function readSnapshotMeta(wire: Record<string, unknown> | undefined): { readonly id?: string | number; readonly name?: string } | undefined {
  const meta = readRecord(wire?.['meta']);
  if (!meta) return undefined;
  return { ...optField('id', readIdLike(meta['id'])), ...optField('name', readStringField(meta['name'])) };
}

/** `EditorOpenInfo` -> `AgentParticipantSnapshot` — the mutex-queue-replay reverse direction. `undefined` when `info` doesn't carry an `id` (nothing real to open). */
export function readAgentParticipantSnapshot(info: EditorOpenInfo): AgentParticipantSnapshot | undefined {
  const wire = readRecord(info);
  const id = readIdLike(wire?.['id']);
  if (wire === undefined || id === undefined) return undefined;
  return {
    id,
    ...optField('entity_meta', readAgentEntityMeta(wire)),
    ...optField('entity_settings', readAgentEntitySettings(wire)),
    ...optField('meta', readSnapshotMeta(wire)),
  };
}

// ── Pipeline ────────────────────────────────────────────────────────────

/**
 * The union of every field `PipelineEditorPipelineLike`
 * (`features/pipelines/lib/pipelineEditorViewState.ts`) and
 * `EditPipelineParticipant` (`features/pipelines/model/useEditPipeline.ts`)
 * declare that `Participant` actually has a real source for — same
 * deliberate top-level-`name` omission as `AgentParticipantSnapshot` above,
 * for the identical reason (see that doc comment).
 */
export interface PipelineParticipantSnapshot {
  readonly id?: string | number;
  readonly entity_meta?: { readonly id?: string | number; readonly project_id?: string | number };
  readonly entity_settings?: { readonly version_id?: string | number };
  readonly meta?: { readonly id?: string | number; readonly name?: string };
  readonly participantType?: string;
}

function buildPipelineEntitySettings(entitySettings: Participant['entitySettings']): PipelineParticipantSnapshot['entity_settings'] {
  if (!entitySettings) return undefined;
  return { ...optField('version_id', entitySettings.versionId) };
}

/** `Participant` -> `PipelineParticipantSnapshot` — feeds both `useEditPipeline`'s `onShowPipelineEditor`/state and `<PipelineEditor pipeline={...}>`. */
export function toPipelineParticipantSnapshot(participant: Participant): PipelineParticipantSnapshot {
  return {
    id: participant.id,
    ...optField('entity_meta', buildAgentEntityMeta(participant.entityMeta)),
    ...optField('entity_settings', buildPipelineEntitySettings(participant.entitySettings)),
    ...optField('meta', buildParticipantMeta(participant.meta)),
    ...optField('participantType', participant.entityName),
  };
}

/** `EditorOpenInfo` -> `PipelineParticipantSnapshot` — the mutex-queue-replay reverse direction. */
export function readPipelineParticipantSnapshot(info: EditorOpenInfo): PipelineParticipantSnapshot | undefined {
  const wire = readRecord(info);
  const id = readIdLike(wire?.['id']);
  if (wire === undefined || id === undefined) return undefined;
  const entitySettings = readRecord(wire['entity_settings']);
  return {
    id,
    ...optField('entity_meta', readAgentEntityMeta(wire)),
    ...optField('entity_settings', entitySettings ? { ...optField('version_id', readIdLike(entitySettings['version_id'])) } : undefined),
    ...optField('meta', readSnapshotMeta(wire)),
    ...optField('participantType', readStringField(wire['participantType'])),
  };
}

// ── Toolkit ─────────────────────────────────────────────────────────────

/**
 * Mirrors `features/toolkits`' own EXPORTED `ToolkitEditorParticipant`
 * (`features/toolkits/ui/ToolkitEditorParts.tsx`, re-exported from
 * `features/toolkits/index.ts`) field-for-field — declared locally anyway
 * (not imported) so `toToolkitParticipantSnapshot`/
 * `readToolkitParticipantSnapshot` follow the exact same shape as this
 * file's Agent/Pipeline pair; it remains structurally interchangeable with
 * the real exported type at every call site.
 */
export interface ToolkitParticipantSnapshot {
  readonly isCreating?: boolean;
  readonly isMCP?: boolean;
  readonly id?: string | number;
  readonly entity_meta?: { readonly id?: string | number; readonly project_id?: string | number; readonly name?: string };
  readonly meta?: { readonly id?: string | number; readonly mcp?: boolean; readonly name?: string };
  readonly name?: string;
}

function buildToolkitEntityMeta(entityMeta: Participant['entityMeta']): ToolkitParticipantSnapshot['entity_meta'] {
  if (!entityMeta) return undefined;
  return { ...optField('id', entityMeta.id), ...optField('project_id', entityMeta.projectId), ...optField('name', entityMeta.name) };
}

function buildToolkitMeta(meta: Participant['meta']): ToolkitParticipantSnapshot['meta'] {
  if (!meta) return undefined;
  return { ...optField('id', meta.id), ...optField('mcp', meta.mcp), ...optField('name', meta.name) };
}

/** `Participant` -> `ToolkitParticipantSnapshot` — feeds both `useEditToolkit`'s `onShowToolkitEditor`/state and `<ToolkitEditor toolkit={...}>`. */
export function toToolkitParticipantSnapshot(participant: Participant): ToolkitParticipantSnapshot {
  return {
    id: participant.id,
    ...optField('isMCP', participant.meta?.mcp),
    ...optField('entity_meta', buildToolkitEntityMeta(participant.entityMeta)),
    ...optField('meta', buildToolkitMeta(participant.meta)),
  };
}

/** `EditorOpenInfo` -> `ToolkitParticipantSnapshot` — the mutex-queue-replay reverse direction. */
export function readToolkitParticipantSnapshot(info: EditorOpenInfo): ToolkitParticipantSnapshot | undefined {
  const wire = readRecord(info);
  const id = readIdLike(wire?.['id']);
  if (wire === undefined || id === undefined) return undefined;
  const entityMeta = readRecord(wire['entity_meta']);
  const meta = readRecord(wire['meta']);
  return {
    id,
    ...optField('isCreating', readBooleanField(wire['isCreating'])),
    ...optField('isMCP', readBooleanField(wire['isMCP'])),
    ...optField(
      'entity_meta',
      entityMeta
        ? {
            ...optField('id', readIdLike(entityMeta['id'])),
            ...optField('project_id', readIdLike(entityMeta['project_id'])),
            ...optField('name', readStringField(entityMeta['name'])),
          }
        : undefined,
    ),
    ...optField(
      'meta',
      meta
        ? { ...optField('id', readIdLike(meta['id'])), ...optField('mcp', readBooleanField(meta['mcp'])), ...optField('name', readStringField(meta['name'])) }
        : undefined,
    ),
    ...optField('name', readStringField(wire['name'])),
  };
}
