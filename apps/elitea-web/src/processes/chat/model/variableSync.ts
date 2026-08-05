/**
 * Ported from `apps/elitea-ui/src/utils/variableSync.js`'s `syncVariableKeys`
 * — agent variables are the source of truth for structure/schema, participant
 * variables preserve custom values. Pure, framework-free; not a hook. Lives
 * in `processes/chat/model` (not `entities/`) because it is genuine
 * cross-feature orchestration glue between an agent's `version_details`
 * variables and a chat participant's `entity_settings` variables — neither
 * side's own entity slice (`entities/application`, `entities/participant`)
 * owns the relationship between the two.
 */

/** One variable row — the shape shared by both an agent's `version_details.variables` and a participant's `entity_settings.variables`; only `name`/`value` are read here, everything else passes through untouched. */
export interface SyncableVariable {
  readonly name?: string;
  readonly value?: unknown;
  readonly [key: string]: unknown;
}

/**
 * `variableSync.js:13-53`. Synchronizes agent variables with participant
 * variables: keys/structure come from `agentVariables` (source of truth),
 * `value`s are preserved from `participantVariables` where a matching
 * `name` exists. Variables present only in `participantVariables` are
 * dropped (agent schema wins); an empty `agentVariables` yields `[]`.
 */
export function syncVariableKeys(
  agentVariables: readonly SyncableVariable[] = [],
  participantVariables: readonly SyncableVariable[] = [],
): SyncableVariable[] {
  if (agentVariables.length === 0) return [];
  if (participantVariables.length === 0) return agentVariables.map((agentVar) => ({ ...agentVar }));

  const participantVarMap = new Map<string, SyncableVariable>();
  participantVariables.forEach((variable) => {
    if (variable.name) participantVarMap.set(variable.name, variable);
  });

  return agentVariables.map((agentVar) => {
    const participantVar = agentVar.name ? participantVarMap.get(agentVar.name) : undefined;
    return participantVar ? { ...agentVar, value: participantVar.value } : { ...agentVar };
  });
}
