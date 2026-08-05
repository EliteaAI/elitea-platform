import { describe, expect, it } from 'vitest';

import { syncVariableKeys } from './variableSync';

describe('syncVariableKeys', () => {
  it('returns [] when agentVariables is empty', () => {
    expect(syncVariableKeys([], [{ name: 'x', value: 1 }])).toEqual([]);
  });

  it('returns agent variables as-is when participantVariables is empty', () => {
    const agentVars = [{ name: 'a', value: 1 }, { name: 'b', value: 2 }];
    expect(syncVariableKeys(agentVars, [])).toEqual(agentVars);
  });

  it('preserves participant value for a matching name, uses agent structure', () => {
    const agentVars = [{ name: 'a', value: 'default', type: 'string' }];
    const participantVars = [{ name: 'a', value: 'custom' }];
    expect(syncVariableKeys(agentVars, participantVars)).toEqual([{ name: 'a', value: 'custom', type: 'string' }]);
  });

  it('uses agent default value for a new agent variable with no participant match', () => {
    const agentVars = [{ name: 'a', value: 'default' }, { name: 'new', value: 'new-default' }];
    const participantVars = [{ name: 'a', value: 'custom' }];
    expect(syncVariableKeys(agentVars, participantVars)).toEqual([
      { name: 'a', value: 'custom' },
      { name: 'new', value: 'new-default' },
    ]);
  });

  it('drops participant-only variables not present in the agent schema', () => {
    const agentVars = [{ name: 'a', value: 1 }];
    const participantVars = [{ name: 'a', value: 2 }, { name: 'stale', value: 3 }];
    const result = syncVariableKeys(agentVars, participantVars);
    expect(result).toEqual([{ name: 'a', value: 2 }]);
    expect(result.find((v) => v.name === 'stale')).toBeUndefined();
  });

  it('defaults both parameters to []', () => {
    expect(syncVariableKeys()).toEqual([]);
  });
});
