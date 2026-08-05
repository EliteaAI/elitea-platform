import { describe, expect, it } from 'vitest';

import { collapseSubAgentInvocationKeys, type SubAgentGroupable } from './subAgentGrouping';

interface Action extends SubAgentGroupable {
  readonly label: string;
}

function action(overrides: Partial<Action>): Action {
  return { type: 'tool', label: '?', ...overrides };
}

const opts = {
  deriveName: (a: Action) => a.parent_agent_name || a.original_name || '',
  deriveRawKey: (a: Action) => a.parent_agent_call_id || '',
  isWrapperCompletion: (a: Action, name: string) =>
    a.type === 'tool' && !a.parent_agent_name && (a.label === name || a.original_name === name) && !a.isError && !!a.toolOutputs,
};

describe('collapseSubAgentInvocationKeys', () => {
  it('leaves coordinator actions (no sub-agent name) untouched', () => {
    const actions = [action({ label: 'search', parent_agent_call_id: 'call-1' })];
    collapseSubAgentInvocationKeys(actions, opts);
    expect(actions[0]?.parent_agent_call_id).toBe('call-1');
  });

  it('stamps every action in a single-round invocation with its own (only) pcid as the anchor', () => {
    const actions = [
      action({ label: 'search', parent_agent_name: 'sub', parent_agent_call_id: 'pcid-1' }),
      action({ label: 'search', parent_agent_name: 'sub', parent_agent_call_id: 'pcid-1', toolOutputs: 'done' }),
    ];
    collapseSubAgentInvocationKeys(actions, opts);
    expect(actions.map((a) => a.parent_agent_call_id)).toEqual(['pcid-1', 'pcid-1']);
  });

  it('folds a fresh-pcid sequential-resume round into the anchor while the block is paused (errored wrapper)', () => {
    const actions = [
      // Round 1: wrapper errors (paused for a nested HITL resume) — no toolOutputs, so isWrapperCompletion stays false.
      action({ label: 'sub', parent_agent_name: 'sub', parent_agent_call_id: 'pcid-1', isError: true }),
      // Round 2 (resume): a brand-new pcid for the SAME logical invocation.
      action({ label: 'sub', parent_agent_name: 'sub', parent_agent_call_id: 'pcid-2', toolOutputs: 'result' }),
    ];
    collapseSubAgentInvocationKeys(actions, opts);
    expect(actions.map((a) => a.parent_agent_call_id)).toEqual(['pcid-1', 'pcid-1']);
  });

  it('does NOT fold a genuinely parallel sibling (interleaved pcids) into the other sibling\'s block', () => {
    const actions = [
      action({ label: 'sub', parent_agent_name: 'sub', parent_agent_call_id: 'pcid-A' }),
      action({ label: 'sub', parent_agent_name: 'sub', parent_agent_call_id: 'pcid-B' }),
      action({ label: 'sub', parent_agent_name: 'sub', parent_agent_call_id: 'pcid-A', toolOutputs: 'done-A' }),
      action({ label: 'sub', parent_agent_name: 'sub', parent_agent_call_id: 'pcid-B', toolOutputs: 'done-B' }),
    ];
    collapseSubAgentInvocationKeys(actions, opts);
    expect(actions.map((a) => a.parent_agent_call_id)).toEqual(['pcid-A', 'pcid-B', 'pcid-A', 'pcid-B']);
  });

  it('returns the same array instance it mutated', () => {
    const actions = [action({ label: 'x' })];
    expect(collapseSubAgentInvocationKeys(actions, opts)).toBe(actions);
  });
});
