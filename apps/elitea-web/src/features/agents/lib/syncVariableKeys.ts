/**
 * Ported verbatim from `apps/elitea-ui/src/utils/variableSync.js`
 * (`syncVariableKeys`, the only export). Used by `model/useEditAgent.ts`'s
 * `handleAgentSaved` to reconcile a chat participant's custom variable
 * VALUES against the just-saved agent version's variable SCHEMA (keys),
 * dropping variables the schema no longer has and seeding new ones with
 * the agent's own default value — same behaviour, same field names
 * (`name`/`value`), no reinterpretation.
 */

export interface AgentVariable {
  readonly name?: string | undefined;
  readonly value?: string | undefined;
}

/**
 * @param agentVariables Variables from the agent's `version_details` — the source of truth for structure/schema.
 * @param participantVariables The participant's current custom values.
 * @returns Variables keyed by the agent schema, with participant values preserved where the key still exists.
 */
export function syncVariableKeys(
  agentVariables: readonly AgentVariable[] = [],
  participantVariables: readonly AgentVariable[] = [],
): AgentVariable[] {
  if (!agentVariables.length) {
    return [];
  }

  if (!participantVariables.length) {
    return agentVariables.map((agentVar) => ({ ...agentVar }));
  }

  const participantVarMap = new Map<string, AgentVariable>();
  participantVariables.forEach((variable) => {
    if (variable.name) {
      participantVarMap.set(variable.name, variable);
    }
  });

  return agentVariables.map((agentVar) => {
    const participantVar = agentVar.name ? participantVarMap.get(agentVar.name) : undefined;
    if (participantVar) {
      return { ...agentVar, value: participantVar.value };
    }
    return { ...agentVar };
  });
}
