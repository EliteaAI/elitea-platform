/**
 * The frames here are not invented: they are the shape a live standalone stack
 * emits, captured from the SSE stream while the backend chat smoke ran
 * (`deploy/scripts/chat-smoke.py`). The happy-path test replays that exact
 * sequence, which is why it is evidence that the reducer renders a real turn
 * rather than a turn someone imagined.
 */
import { describe, expect, it } from 'vitest';

import { applyChatStreamFrame, mcpSessionFromFrame, type ChatStreamContext, type ToolAction } from './chatStreamReducer';
import { HANDLED_STREAM_TYPES, SocketMessageType, isChatStreamFrame } from './chatStreamFrame';
import type { ChatMessage } from './convertMessagesToChatHistory';

const MESSAGE_ID = '63c6d989-2860-5d68-9e3e-3587c63350d3';
const QUESTION_ID = '11111111-2222-3333-4444-555555555555';
const CONTEXT: ChatStreamContext = { name: 'Agent', now: () => '2026-08-13T00:00:00.000Z' };

/** The assistant placeholder the send path appends before the stream opens. */
function pendingAssistant(): ChatMessage {
  return {
    id: MESSAGE_ID,
    role: 'assistant',
    name: 'Agent',
    content: '',
    createdAt: '2026-08-13T00:00:00.000Z',
    questionId: QUESTION_ID,
    isStreaming: true,
    isLoading: true,
  };
}

function frame(type: string, extra: Record<string, unknown> = {}) {
  return { type, message_id: MESSAGE_ID, question_id: QUESTION_ID, stream_id: 's-1', ...extra };
}

describe('applyChatStreamFrame', () => {
  it('renders a real turn from the sequence a live stack emits', () => {
    // Recorded order: agent_start, agent_on_transitional_edge, agent_llm_start,
    // agent_llm_chunk ×4, agent_llm_end, agent_response, pipeline_finish.
    const sequence = [
      frame(SocketMessageType.AgentStart),
      frame(SocketMessageType.AgentOnTransitionalEdge),
      frame(SocketMessageType.AgentLlmStart),
      frame(SocketMessageType.AgentLlmChunk, { content: 'MOCK: ' }),
      frame(SocketMessageType.AgentLlmChunk, { content: 'chat ' }),
      frame(SocketMessageType.AgentLlmChunk, { content: 'smoke ' }),
      frame(SocketMessageType.AgentLlmChunk, { content: '1786639081 ' }),
      frame(SocketMessageType.AgentLlmEnd),
      frame(SocketMessageType.PipelineFinish),
    ];

    const result = sequence.reduce(
      (history, next) => applyChatStreamFrame(history, next, CONTEXT),
      [pendingAssistant()] as readonly ChatMessage[],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe('MOCK: chat smoke 1786639081 ');
    expect(result[0]?.isStreaming).toBe(false);
    expect(result[0]?.isLoading).toBe(false);
  });

  it('finishes the turn on a response carrying finish_reason, and keeps the thread id', () => {
    const history = applyChatStreamFrame(
      [{ ...pendingAssistant(), content: 'partial' }],
      frame(SocketMessageType.AgentResponse, {
        content: '',
        response_metadata: { finish_reason: 'stop', metadata: { thread_id: 'thread-9' } },
      }),
      CONTEXT,
    );

    expect(history[0]?.isStreaming).toBe(false);
    expect(history[0]?.threadId).toBe('thread-9');
  });

  it('does NOT finish the turn on an intermediate response with no finish_reason', () => {
    // A mid-turn agent_response is ordinary in a pipeline; treating it as
    // terminal would stop the spinner while tokens are still arriving.
    const history = applyChatStreamFrame(
      [pendingAssistant()],
      frame(SocketMessageType.AgentResponse, { content: 'step one' }),
      CONTEXT,
    );

    expect(history[0]?.isStreaming).toBe(true);
    expect(history[0]?.content).toContain('step one');
  });

  it('resets content when a turn restarts, so a regenerate does not append', () => {
    const history = applyChatStreamFrame(
      [{ ...pendingAssistant(), content: 'previous answer' }],
      frame(SocketMessageType.AgentStart),
      CONTEXT,
    );

    expect(history[0]?.content).toBe('');
  });

  it('surfaces a failure without discarding what already streamed', () => {
    const history = applyChatStreamFrame(
      [{ ...pendingAssistant(), content: 'got this far' }],
      frame(SocketMessageType.AgentException, { content: 'boom' }),
      CONTEXT,
    );

    expect(history[0]?.exception).toBe('boom');
    expect(history[0]?.isStreaming).toBe(false);
    // The partial answer is what the user watched arrive; hiding it would erase
    // the only evidence of how far the run got.
    expect(history[0]?.content).toBe('got this far');
  });

  it('resolves a frame by question id when the assistant message has no id yet', () => {
    const pending: ChatMessage = { ...pendingAssistant(), id: 'local-placeholder' };
    const history = applyChatStreamFrame(
      [pending],
      { type: SocketMessageType.AgentLlmChunk, question_id: QUESTION_ID, content: 'hi' },
      CONTEXT,
    );

    expect(history).toHaveLength(1);
    expect(history[0]?.content).toBe('hi');
  });

  it('creates the assistant message when a chunk arrives for one it has never seen', () => {
    const history = applyChatStreamFrame([], frame(SocketMessageType.AgentLlmChunk, { content: 'hello' }), CONTEXT);

    expect(history).toHaveLength(1);
    expect(history[0]?.role).toBe('assistant');
    expect(history[0]?.content).toBe('hello');
  });

  it('leaves state untouched — by reference — for a type this slice has not ported', () => {
    // The reference check is the assertion that matters: an unported frame must
    // be inert, never a partial write, and must not re-render the list.
    const before: readonly ChatMessage[] = [pendingAssistant()];
    const after = applyChatStreamFrame(before, frame(SocketMessageType.AgentHitlInterrupt), CONTEXT);

    expect(after).toBe(before);
  });

  it('ignores a frame with no type at all', () => {
    const before: readonly ChatMessage[] = [pendingAssistant()];
    expect(applyChatStreamFrame(before, { message_id: MESSAGE_ID }, CONTEXT)).toBe(before);
  });
});

describe('the ported boundary is explicit', () => {
  it('every handled type is reduced, and every unhandled one is inert', () => {
    // The fixture satisfies EVERY handled case's preconditions — including an
    // already-started tool action, which the end/error cases require — so a
    // "handled type changed nothing" failure means the case is genuinely
    // unreachable rather than under-supplied by the test.
    const before: readonly ChatMessage[] = [
      { ...pendingAssistant(), toolActions: [{ id: 'run-x', type: 'tool', status: 'processing' } as ToolAction] },
    ];

    for (const type of Object.values(SocketMessageType)) {
      const next = applyChatStreamFrame(
        before,
        frame(type, { content: 'x', references: [], response_metadata: { tool_run_id: 'run-x' } }),
        CONTEXT,
      );
      if (HANDLED_STREAM_TYPES.has(type)) {
        expect(next, `${type} is listed as handled but changed nothing`).not.toBe(before);
      } else {
        expect(next, `${type} is not ported but mutated state`).toBe(before);
      }
    }
  });
});

describe('isChatStreamFrame', () => {
  it('accepts a frame with a type and rejects anything else', () => {
    expect(isChatStreamFrame({ type: 'agent_llm_chunk' })).toBe(true);
    expect(isChatStreamFrame({ message_id: 'x' })).toBe(false);
    expect(isChatStreamFrame(null)).toBe(false);
    expect(isChatStreamFrame('agent_llm_chunk')).toBe(false);
  });
});

describe('the tool lifecycle', () => {
  const RUN_ID = 'run-1';

  function toolFrame(type: string, responseMetadata: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return frame(type, { response_metadata: { tool_run_id: RUN_ID, ...responseMetadata }, ...extra });
  }

  function withStartedTool(): readonly ChatMessage[] {
    return applyChatStreamFrame(
      [pendingAssistant()],
      toolFrame(SocketMessageType.AgentToolStart, {
        tool_name: 'jira___create_issue',
        tool_inputs: { summary: 'hi' },
        metadata: { thread_id: 'thread-3' },
      }),
      CONTEXT,
    );
  }

  it('creates a processing tool action and captures the thread id', () => {
    const history = withStartedTool();
    const action = (history[0]?.toolActions ?? [])[0] as ToolAction | undefined;

    expect(action?.['id']).toBe(RUN_ID);
    expect(action?.['status']).toBe('processing');
    expect(action?.['type']).toBe('tool');
    expect(action?.['toolInputs']).toEqual({ summary: 'hi' });
    expect(history[0]?.threadId).toBe('thread-3');
  });

  it('derives the toolkit from the legacy toolkit___tool name when metadata omits it', () => {
    const action = (withStartedTool()[0]?.toolActions ?? [])[0] as ToolAction;
    expect((action['toolMeta'] as Record<string, unknown>)['toolkit_name']).toBe('jira');
  });

  it('recovers a toolkit name from either description shape', () => {
    for (const [description, expected] of [
      ['[Toolkit: vectorstore]\nDoes things', 'vectorstore'],
      ['Does things\nToolkit: confluence', 'confluence'],
    ] as const) {
      const history = applyChatStreamFrame(
        [pendingAssistant()],
        toolFrame(SocketMessageType.AgentToolStart, { tool_name: 'search', tool_meta: { description } }),
        CONTEXT,
      );
      const action = (history[0]?.toolActions ?? [])[0] as ToolAction;
      expect((action['toolMeta'] as Record<string, unknown>)['toolkit_name']).toBe(expected);
    }
  });

  it('prefers the real tool name over a lazy-loading wrapper class', () => {
    // Without this the chip reads "LazyLoading" instead of the invoked tool.
    const history = applyChatStreamFrame(
      [pendingAssistant()],
      toolFrame(SocketMessageType.AgentToolStart, {
        tool_name: 'LazyLoading',
        tool_meta: { name: 'get_plan_status', metadata: { original_name: 'get_plan_status' } },
      }),
      CONTEXT,
    );
    const action = (history[0]?.toolActions ?? [])[0] as ToolAction;

    expect(action['name']).toBe('get_plan_status');
    expect(action['original_name']).toBe('get_plan_status');
  });

  it('does not duplicate an action when the same run id starts twice', () => {
    const once = withStartedTool();
    const twice = applyChatStreamFrame(once, toolFrame(SocketMessageType.AgentToolStart, {}), CONTEXT);

    expect(twice[0]?.toolActions).toHaveLength(1);
  });

  it('accumulates string outputs across end frames rather than replacing them', () => {
    // A tool can report progressively; replacing would keep only the last frame.
    let history = withStartedTool();
    history = applyChatStreamFrame(history, toolFrame(SocketMessageType.AgentToolEnd, { tool_output: 'part one ' }), CONTEXT);
    history = applyChatStreamFrame(history, toolFrame(SocketMessageType.AgentToolEnd, { tool_output: 'part two' }), CONTEXT);
    const action = (history[0]?.toolActions ?? [])[0] as ToolAction;

    expect(String(action['toolOutputs'])).toContain('part one');
    expect(String(action['toolOutputs'])).toContain('part two');
    expect(action['status']).toBe('complete');
  });

  it('merges object outputs', () => {
    let history = withStartedTool();
    history = applyChatStreamFrame(history, toolFrame(SocketMessageType.AgentToolEnd, { tool_output: { a: 1 } }), CONTEXT);
    history = applyChatStreamFrame(history, toolFrame(SocketMessageType.AgentToolEnd, { tool_output: { b: 2 } }), CONTEXT);
    const action = (history[0]?.toolActions ?? [])[0] as ToolAction;

    expect(action['toolOutputs']).toEqual({ a: 1, b: 2 });
  });

  it('leaves an approval-gated action awaiting approval when its wrapper ends', () => {
    // The wrapper ending is not the user answering.
    const started = withStartedTool();
    const gated = started.map((message) => ({
      ...message,
      toolActions: (message.toolActions ?? []).map((action) => ({ ...action, status: 'action_required' })),
    })) as readonly ChatMessage[];
    const ended = applyChatStreamFrame(gated, toolFrame(SocketMessageType.AgentToolEnd, {}), CONTEXT);
    const action = (ended[0]?.toolActions ?? [])[0] as ToolAction;

    expect(action['status']).toBe('action_required');
  });

  it('marks a failed tool without touching the others', () => {
    let history = withStartedTool();
    history = applyChatStreamFrame(
      history,
      frame(SocketMessageType.AgentToolStart, { response_metadata: { tool_run_id: 'run-2', tool_name: 'other' } }),
      CONTEXT,
    );
    history = applyChatStreamFrame(history, toolFrame(SocketMessageType.AgentToolError, {}, { content: 'boom' }), CONTEXT);
    const actions = (history[0]?.toolActions ?? []) as readonly ToolAction[];

    expect(actions).toHaveLength(2);
    expect(actions[0]?.['status']).toBe('error');
    expect(actions[0]?.['isError']).toBe(true);
    expect(actions[1]?.['status']).toBe('processing');
  });

  it('ignores an end or error for a run id it never saw start', () => {
    const before = withStartedTool();
    expect(applyChatStreamFrame(before, frame(SocketMessageType.AgentToolEnd, { response_metadata: { tool_run_id: 'ghost' } }), CONTEXT)).toBe(before);
    expect(applyChatStreamFrame(before, frame(SocketMessageType.AgentToolError, { response_metadata: { tool_run_id: 'ghost' } }), CONTEXT)).toBe(before);
  });
});

describe('mcpSessionFromFrame', () => {
  it('surfaces the session a caller must persist, since the reducer cannot', () => {
    expect(
      mcpSessionFromFrame({
        type: SocketMessageType.AgentToolEnd,
        response_metadata: { metadata: { mcp_session_id: 's-1', mcp_server_url: 'https://mcp.example' } },
      }),
    ).toEqual({ sessionId: 's-1', serverUrl: 'https://mcp.example' });
  });

  it('returns nothing when either half is missing', () => {
    expect(mcpSessionFromFrame({ type: 'x', response_metadata: { metadata: { mcp_session_id: 's-1' } } })).toBeUndefined();
    expect(mcpSessionFromFrame({ type: 'x' })).toBeUndefined();
  });
});

describe('thinking steps', () => {
  const RUN = 'run-think';

  function withAction(overrides: Partial<ToolAction> = {}): readonly ChatMessage[] {
    return [
      {
        ...pendingAssistant(),
        toolActions: [{ id: RUN, type: 'tool', status: 'processing', ...overrides } as ToolAction],
      },
    ];
  }

  function actionsOf(history: readonly ChatMessage[]): readonly ToolAction[] {
    return (history[0]?.toolActions ?? []) as readonly ToolAction[];
  }

  it('creates a placeholder when a step arrives before its tool started', () => {
    // Steps can precede agent_tool_start; dropping them loses the progress the
    // user is waiting to see.
    const history = applyChatStreamFrame(
      [pendingAssistant()],
      frame(SocketMessageType.AgentThinkingStep, {
        response_metadata: { tool_run_id: RUN, message: 'searching…' },
      }),
      CONTEXT,
    );
    const action = actionsOf(history)[0];

    expect(action?.id).toBe(`thinking_step_${RUN}`);
    expect(action?.['message']).toBe('searching…');
    expect(action?.status).toBe('processing');
  });

  it('gives id-less steps DISTINCT placeholders', () => {
    // The baseline's `'thinking_step_' + id || '' + v4()` parses as
    // `('thinking_step_' + id) || …`, always truthy, so every id-less step
    // collided on "thinking_step_undefined". Two steps must not become one.
    let history = applyChatStreamFrame([pendingAssistant()], frame(SocketMessageType.AgentThinkingStep, {}), CONTEXT);
    history = applyChatStreamFrame(history, frame(SocketMessageType.AgentThinkingStep, {}), CONTEXT);
    const ids = actionsOf(history).map((action) => action.id);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('updates an existing action instead of adding a second one', () => {
    const history = applyChatStreamFrame(
      withAction(),
      frame(SocketMessageType.AgentThinkingStep, { response_metadata: { tool_run_id: RUN, message: 'step two' } }),
      CONTEXT,
    );

    expect(actionsOf(history)).toHaveLength(1);
    expect(actionsOf(history)[0]?.['message']).toBe('step two');
  });

  it('honours an explicit markdown:false, which the baseline could not', () => {
    // `markdown || true` can only ever be true.
    const history = applyChatStreamFrame(
      withAction(),
      frame(SocketMessageType.AgentThinkingStep, {
        response_metadata: { tool_run_id: RUN, markdown: false, message: 'x' },
      }),
      CONTEXT,
    );

    expect(actionsOf(history)[0]?.['markdown']).toBe(false);
  });

  it('applies progress text on an update', () => {
    const history = applyChatStreamFrame(
      withAction(),
      frame(SocketMessageType.AgentThinkingStepUpdate, {
        response_metadata: { tool_run_id: RUN, message: 'half done', tool_meta: { toolkit_name: 'jira' } },
      }),
      CONTEXT,
    );
    const action = actionsOf(history)[0];

    expect(String(action?.['message'])).toContain('half done');
    expect((action?.toolMeta ?? {})['toolkit_name']).toBe('jira');
  });

  it('ignores an update for a step it never saw', () => {
    const before = withAction();
    expect(
      applyChatStreamFrame(before, frame(SocketMessageType.AgentThinkingStepUpdate, { response_metadata: { tool_run_id: 'ghost' } }), CONTEXT),
    ).toBe(before);
  });

  describe('the agent_llm_end fan-out', () => {
    it('closes every step in one batch, not just the first', () => {
      // A pipeline with several LLM nodes reports them all in one frame.
      const history: readonly ChatMessage[] = [
        {
          ...pendingAssistant(),
          toolActions: [
            { id: 'a', type: 'tool', status: 'processing', parent_agent_name: 'root' } as ToolAction,
            { id: 'b', type: 'tool', status: 'processing', parent_agent_name: 'root' } as ToolAction,
          ],
        },
      ];
      const next = applyChatStreamFrame(
        history,
        frame(SocketMessageType.AgentLlmEnd, {
          response_metadata: {
            thinking_steps: [
              { tool_run_id: 'a', text: 'did a' },
              { tool_run_id: 'b', text: 'did b' },
            ],
          },
        }),
        CONTEXT,
      );

      expect(actionsOf(next).map((action) => action.status)).toEqual(['complete', 'complete']);
      expect(actionsOf(next)[0]?.['content']).toContain('did a');
    });

    it('drops an empty transition step rather than showing plumbing', () => {
      const history: readonly ChatMessage[] = [
        { ...pendingAssistant(), toolActions: [{ id: 'a', type: 'tool', status: 'processing' } as ToolAction] },
      ];
      const next = applyChatStreamFrame(
        history,
        frame(SocketMessageType.AgentLlmEnd, { response_metadata: { thinking_steps: [{ tool_run_id: 'a', text: '   ' }] } }),
        CONTEXT,
      );

      expect(actionsOf(next)).toHaveLength(0);
    });

    it('keeps an empty step that belongs to a parent agent', () => {
      const history: readonly ChatMessage[] = [
        {
          ...pendingAssistant(),
          toolActions: [{ id: 'a', type: 'tool', status: 'processing', parent_agent_name: 'planner' } as ToolAction],
        },
      ];
      const next = applyChatStreamFrame(
        history,
        frame(SocketMessageType.AgentLlmEnd, { response_metadata: { thinking_steps: [{ tool_run_id: 'a', text: '' }] } }),
        CONTEXT,
      );

      expect(actionsOf(next)).toHaveLength(1);
    });

    it('strips the verbose "with inputs {...}" tail the UI already renders', () => {
      const next = applyChatStreamFrame(
        withAction({ parent_agent_name: 'root' } as Partial<ToolAction>),
        frame(SocketMessageType.AgentLlmEnd, {
          response_metadata: { thinking_steps: [{ tool_run_id: RUN, text: 'called search with inputs {"q": 1}' }] },
        }),
        CONTEXT,
      );

      expect(String(actionsOf(next)[0]?.['content'])).not.toContain('with inputs');
      expect(String(actionsOf(next)[0]?.['content'])).toContain('called search');
    });

    it('recovers the run id from the message id when the step omits it', () => {
      const next = applyChatStreamFrame(
        withAction({ parent_agent_name: 'root' } as Partial<ToolAction>),
        frame(SocketMessageType.AgentLlmEnd, {
          response_metadata: { thinking_steps: [{ text: 'done', message: { id: `lc_run--${RUN}` } }] },
        }),
        CONTEXT,
      );

      expect(actionsOf(next)[0]?.status).toBe('complete');
    });

    it('closes the frame\'s own tool but leaves an approval-gated one alone', () => {
      const history: readonly ChatMessage[] = [
        {
          ...pendingAssistant(),
          toolActions: [
            { id: 'p', type: 'tool', status: 'processing' } as ToolAction,
            { id: 'g', type: 'tool', status: 'action_required' } as ToolAction,
          ],
        },
      ];
      let next = applyChatStreamFrame(history, frame(SocketMessageType.AgentLlmEnd, { response_metadata: { tool_run_id: 'p' } }), CONTEXT);
      next = applyChatStreamFrame(next, frame(SocketMessageType.AgentLlmEnd, { response_metadata: { tool_run_id: 'g' } }), CONTEXT);

      expect(actionsOf(next)[0]?.status).toBe('complete');
      expect(actionsOf(next)[1]?.status).toBe('action_required');
    });

    it('still stops the spinner when there are no steps at all', () => {
      const next = applyChatStreamFrame([pendingAssistant()], frame(SocketMessageType.AgentLlmEnd), CONTEXT);
      expect(next[0]?.isLoading).toBe(false);
    });
  });
});
