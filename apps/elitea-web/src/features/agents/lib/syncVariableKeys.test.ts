import { describe, expect, it } from 'vitest';

import { syncVariableKeys } from './syncVariableKeys';

describe('syncVariableKeys', () => {
  it('returns an empty array when the agent has no variables', () => {
    expect(syncVariableKeys([], [{ name: 'foo', value: 'bar' }])).toEqual([]);
  });

  it('uses agent defaults verbatim when the participant has no custom values', () => {
    const agentVars = [{ name: 'foo', value: 'default' }];
    expect(syncVariableKeys(agentVars, [])).toEqual([{ name: 'foo', value: 'default' }]);
  });

  it('returns copies, not the same object references, for the default-value path', () => {
    const agentVars = [{ name: 'foo', value: 'default' }];
    const result = syncVariableKeys(agentVars, []);
    expect(result[0]).not.toBe(agentVars[0]);
  });

  it('preserves the participant custom value for a variable that still exists on the agent', () => {
    const agentVars = [{ name: 'foo', value: 'agent-default' }];
    const participantVars = [{ name: 'foo', value: 'user-custom' }];
    expect(syncVariableKeys(agentVars, participantVars)).toEqual([{ name: 'foo', value: 'user-custom' }]);
  });

  it('drops participant variables that no longer exist on the agent schema', () => {
    const agentVars = [{ name: 'foo', value: 'agent-default' }];
    const participantVars = [
      { name: 'foo', value: 'user-custom' },
      { name: 'stale', value: 'gone' },
    ];
    const result = syncVariableKeys(agentVars, participantVars);
    expect(result).toEqual([{ name: 'foo', value: 'user-custom' }]);
    expect(result.some((v) => v.name === 'stale')).toBe(false);
  });

  it('seeds a new agent variable with its own default when the participant lacks it', () => {
    const agentVars = [
      { name: 'foo', value: 'agent-default' },
      { name: 'newVar', value: 'new-default' },
    ];
    const participantVars = [{ name: 'foo', value: 'user-custom' }];
    const result = syncVariableKeys(agentVars, participantVars);
    expect(result).toEqual([
      { name: 'foo', value: 'user-custom' },
      { name: 'newVar', value: 'new-default' },
    ]);
  });
});
