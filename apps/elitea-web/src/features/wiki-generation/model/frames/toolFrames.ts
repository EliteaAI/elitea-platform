/**
 * agent_tool_start and agent_tool_end.
 *
 * A tool END is where the slots-full refusal arrives, which is why it runs the
 * error sniffer rather than assuming a tool that ended succeeded.
 */
import { parseAgentResponseForError } from '../../lib/parseAgentResponseForError';
import type { GenerationFrame, GenerationResult, GenerationState } from '../types';
import { addStep, firstString } from './shared';

export function reduceToolStart(
  state: GenerationState,
  frame: GenerationFrame,
): GenerationResult {
  const toolName = firstString(frame.response_metadata, 'tool_name') ?? 'tool';
  return {
    state: { ...state, status: { status: 'running', message: `Running ${toolName}...` } },
    effects: [],
  };
}

export function reduceToolEnd(
  state: GenerationState,
  frame: GenerationFrame,
  now: () => number,
): GenerationResult {
  const parsed = parseAgentResponseForError(frame.content, frame.response_metadata);
  // A tool that ended without an error marker is intermediate progress, and
  // the legacy code says nothing about it — the run is not over.
  if (!parsed.isError) return { state, effects: [] };

  const message = parsed.message ?? 'Wiki generation failed';
  const added = addStep(state, message, 'error', frame.response_metadata, now);
  return {
    state: {
      ...state,
      errored: true,
      thinkingSteps: added.steps,
      stepCounter: added.counter,
      status: { status: 'error', message },
    },
    effects: [{ kind: 'cleanup' }],
  };
}
