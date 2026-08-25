import { describe, expect, it } from 'vitest';

import { isAgentGraphEvent, shouldForwardAgentEvent } from './agentGraphEvents';
import { SocketMessageType } from './chatStreamFrame';

describe('isAgentGraphEvent', () => {
  it('matches the graph frames the worker emits beyond the five the baseline names', () => {
    // `agent_events.py:41-47` maps seven graph events, including
    // on_loop_tool_node / on_loop_node, against the five the baseline names. They
    // reached the flow editor only through the baseline's `default` branch, so
    // a closed list here would silently stop highlighting loop nodes.
    expect(isAgentGraphEvent('agent_on_loop_tool_node')).toBe(true);
    expect(isAgentGraphEvent('agent_on_loop_node')).toBe(true);
    expect(isAgentGraphEvent(SocketMessageType.AgentOnDecisionEdge)).toBe(true);
  });

  it('does not match chat frames that merely start with agent_', () => {
    expect(isAgentGraphEvent(SocketMessageType.AgentLlmChunk)).toBe(false);
    expect(isAgentGraphEvent(SocketMessageType.AgentResponse)).toBe(false);
    expect(isAgentGraphEvent(undefined)).toBe(false);
  });
});

describe('shouldForwardAgentEvent', () => {
  it('forwards agent_response but NOT its two fall-through siblings', () => {
    // The baseline shares one case body for agent_response / chunk /
    // AIMessageChunk and then re-tests the type before forwarding
    // (hooks.js:546-548). Reading the shared body as "all three forward" would
    // push every streamed token at the run timeline.
    expect(shouldForwardAgentEvent(SocketMessageType.AgentResponse)).toBe(true);
    expect(shouldForwardAgentEvent(SocketMessageType.Chunk)).toBe(false);
    expect(shouldForwardAgentEvent(SocketMessageType.AIMessageChunk)).toBe(false);
  });

  it('forwards every graph frame, including ones no enum member names', () => {
    expect(shouldForwardAgentEvent(SocketMessageType.AgentOnToolNode)).toBe(true);
    expect(shouldForwardAgentEvent(SocketMessageType.AgentOnTransitionalEdge)).toBe(true);
    expect(shouldForwardAgentEvent('agent_on_loop_node')).toBe(true);
  });

  it('withholds the frames the baseline handles but never forwards', () => {
    // Not an oversight in the baseline: the run timeline has no entry for a
    // per-token chunk or a references payload.
    for (const type of [
      SocketMessageType.AgentLlmChunk,
      SocketMessageType.AgentThinkingStepUpdate,
      SocketMessageType.References,
      SocketMessageType.ChatUserMessage,
      SocketMessageType.Error,
      SocketMessageType.LlmError,
      SocketMessageType.Freeform,
      SocketMessageType.SwarmChildMessage,
      SocketMessageType.ChatPredictSummaryStarted,
      SocketMessageType.ChatPredictSummaryFinished,
    ]) {
      expect(shouldForwardAgentEvent(type), `${type} should not reach the flow editor`).toBe(false);
    }
  });

  it('forwards the lifecycle frames the run timeline is built from', () => {
    for (const type of [
      SocketMessageType.StartTask,
      SocketMessageType.AgentStart,
      SocketMessageType.AgentLlmStart,
      SocketMessageType.AgentLlmEnd,
      SocketMessageType.AgentToolStart,
      SocketMessageType.AgentToolEnd,
      SocketMessageType.AgentToolError,
      SocketMessageType.AgentThinkingStep,
      SocketMessageType.AgentException,
      SocketMessageType.McpAuthorizationRequired,
      SocketMessageType.AgentRequiresConfirmation,
      SocketMessageType.AgentHitlInterrupt,
      SocketMessageType.PipelineFinish,
    ]) {
      expect(shouldForwardAgentEvent(type), `${type} should reach the flow editor`).toBe(true);
    }
  });

  it('ignores a frame with no type', () => {
    expect(shouldForwardAgentEvent(undefined)).toBe(false);
    expect(shouldForwardAgentEvent('')).toBe(false);
  });
});
