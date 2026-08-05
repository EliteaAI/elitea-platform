import { describe, expect, it } from 'vitest';

import { PIPELINE_SOCKET_MESSAGE_TYPE, findNode, toolkitNameFromRawToolName } from './parseRunsByEvent.support';

describe('PIPELINE_SOCKET_MESSAGE_TYPE', () => {
  it('matches the baseline common/constants.js snake_case values', () => {
    expect(PIPELINE_SOCKET_MESSAGE_TYPE.AgentStart).toBe('agent_start');
    expect(PIPELINE_SOCKET_MESSAGE_TYPE.PipelineFinish).toBe('pipeline_finish');
    expect(PIPELINE_SOCKET_MESSAGE_TYPE.AgentOnConditionalEdge).toBe('agent_on_conditional_edge');
  });
});

describe('toolkitNameFromRawToolName', () => {
  it('splits the old toolkit___tool format at the separator', () => {
    expect(toolkitNameFromRawToolName('github___create_issue')).toBe('github');
  });

  it('passes a clean tool name through unchanged', () => {
    expect(toolkitNameFromRawToolName('create_issue')).toBe('create_issue');
  });
});

describe('findNode', () => {
  const nodes = [{ id: 'Agent 1', type: 'agent' }];

  it('matches via toolkit_name when the node declares one, either direction of prefix', () => {
    const withToolkit = [{ id: 'x', toolkit_name: 'github', type: 'tool' }];
    // event's raw name is longer than the node's toolkit_name -> tool_name.startsWith(toolkit_name)
    expect(findNode(withToolkit, 'github_create_issue')?.id).toBe('x');
    // node's toolkit_name is longer than the event's raw name -> toolkit_name.startsWith(tool_name)
    expect(findNode(withToolkit, 'git')?.id).toBe('x');
    expect(findNode(withToolkit, 'gitlab')).toBeUndefined();
  });

  it('falls back to id-prefix matching (spaces stripped) when toolkit_name is absent', () => {
    expect(findNode(nodes, 'Agent1_extra')?.id).toBe('Agent 1');
  });

  it('matches an Agent node by its `tool` field as a last resort', () => {
    const agentNodes = [{ id: 'A', tool: 'my_tool', type: 'agent' }];
    expect(findNode(agentNodes, 'my_tool')?.id).toBe('A');
  });

  it('returns undefined when nothing matches', () => {
    expect(findNode(nodes, 'totally_unrelated')).toBeUndefined();
  });
});
