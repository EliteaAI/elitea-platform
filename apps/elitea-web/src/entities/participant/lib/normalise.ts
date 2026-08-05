import type {
  Participant,
  ParticipantEntityMeta,
  ParticipantMeta,
  ParticipantSettings,
  ParticipantType,
} from '../model/types';

/**
 * Wire -> domain normaliser for the `participant` slice's own CRUD
 * responses (`../api/participantApi.ts`). There is no OpenAPI schema for
 * this envelope (see `model/types.ts`'s module doc) — the wire shape here is
 * `conversations.Participant`, the handler-local Go struct actually
 * marshaled by `AddParticipant`/`ListParticipants`
 * (`services/elitea-main/internal/api/v2/conversations/handler.go:59-65`):
 * `{id: int, entity_name: string, entity_meta: map[string]any,
 * entity_settings: map[string]any, meta: map[string]any}`. `entity_meta`/
 * `entity_settings`/`meta` are untyped on the Go side too (best-effort
 * `json.Unmarshal` into `map[string]any`,
 * `internal/infra/db/repos/conversations.go:118-129`), so this normaliser
 * reads their known sub-fields defensively rather than assuming a schema.
 */

/** `id` is a Go `int` (`json:"id"`, no string formatting) — a real JSON number on the wire, unlike e.g. `UserRecord.id`. */
export interface ParticipantWire {
  readonly id: number;
  readonly entity_name: string;
  readonly entity_meta?: Readonly<Record<string, unknown>> | null;
  readonly entity_settings?: Readonly<Record<string, unknown>> | null;
  readonly meta?: Readonly<Record<string, unknown>> | null;
}

const PARTICIPANT_TYPES: ReadonlySet<string> = new Set<ParticipantType>([
  'application',
  'toolkit',
  'llm',
  'user',
  'pipeline',
  'skill',
  'dummy',
]);

/**
 * `entity_name` arrives as a plain string on the wire (no server-side enum
 * validation — `AddParticipant`, handler.go:243, reads it straight off the
 * request body). An unrecognised value falls back to `'dummy'`, the same
 * inert default `participantDisplayName`'s own resolver table already
 * treats as a no-op/system-only participant type, rather than throwing on
 * malformed data from a live socket/HTTP boundary.
 */
function toParticipantType(value: string): ParticipantType {
  return PARTICIPANT_TYPES.has(value) ? (value as ParticipantType) : 'dummy';
}

function readString(record: Readonly<Record<string, unknown>> | null | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(record: Readonly<Record<string, unknown>> | null | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

function normaliseEntityMeta(wire: Readonly<Record<string, unknown>> | null | undefined): ParticipantEntityMeta | undefined {
  if (wire === null || wire === undefined) return undefined;
  const id = readString(wire, 'id');
  const name = readString(wire, 'name');
  const projectId = readString(wire, 'project_id');
  const modelName = readString(wire, 'model_name');
  const integrationUid = readString(wire, 'integration_uid');
  return {
    ...(id !== undefined ? { id } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(modelName !== undefined ? { modelName } : {}),
    ...(integrationUid !== undefined ? { integrationUid } : {}),
  };
}

function normaliseMeta(wire: Readonly<Record<string, unknown>> | null | undefined): ParticipantMeta | undefined {
  if (wire === null || wire === undefined) return undefined;
  const id = readString(wire, 'id');
  const name = readString(wire, 'name');
  const userName = readString(wire, 'user_name');
  const userAvatar = readString(wire, 'user_avatar');
  const isContainer = readBoolean(wire, 'is_container');
  const mcp = readBoolean(wire, 'mcp');
  return {
    ...(id !== undefined ? { id } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(userName !== undefined ? { userName } : {}),
    ...(userAvatar !== undefined ? { userAvatar } : {}),
    ...(isContainer !== undefined ? { isContainer } : {}),
    ...(mcp !== undefined ? { mcp } : {}),
  };
}

function normaliseEntitySettings(wire: Readonly<Record<string, unknown>> | null | undefined): ParticipantSettings | undefined {
  if (wire === null || wire === undefined) return undefined;
  const versionId = wire['version_id'];
  const llmSettings = wire['llm_settings'];
  const toolkitType = readString(wire, 'toolkit_type');
  const agentType = readString(wire, 'agent_type');
  const mcpServerUrl = readString(wire, 'mcp_server_url');
  return {
    ...(llmSettings !== undefined && llmSettings !== null
      ? { llmSettings: llmSettings as Readonly<Record<string, unknown>> }
      : {}),
    ...(typeof versionId === 'string' || typeof versionId === 'number' ? { versionId } : {}),
    ...('variables' in wire ? { variables: wire['variables'] } : {}),
    ...('icon_meta' in wire ? { iconMeta: wire['icon_meta'] } : {}),
    ...(toolkitType !== undefined ? { toolkitType } : {}),
    ...(agentType !== undefined ? { agentType } : {}),
    ...(mcpServerUrl !== undefined ? { mcpServerUrl } : {}),
  };
}

/** `conversations.Participant` wire -> the `Participant` domain type. */
export function normaliseParticipant(wire: ParticipantWire): Participant {
  const entityMeta = normaliseEntityMeta(wire.entity_meta);
  const meta = normaliseMeta(wire.meta);
  const entitySettings = normaliseEntitySettings(wire.entity_settings);
  return {
    id: String(wire.id),
    entityName: toParticipantType(wire.entity_name),
    ...(entityMeta !== undefined ? { entityMeta } : {}),
    ...(meta !== undefined ? { meta } : {}),
    ...(entitySettings !== undefined ? { entitySettings } : {}),
  };
}

export function normaliseParticipants(wire: readonly ParticipantWire[]): Participant[] {
  return wire.map(normaliseParticipant);
}
