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
    const after = applyChatStreamFrame(before, frame(SocketMessageType.SwarmChildMessage), CONTEXT);

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

describe('applyChatStreamFrame — interrupts', () => {
  function interruptsOf(history: readonly ChatMessage[]): readonly Record<string, unknown>[] {
    return (history[0]?.hitlInterrupts ?? []) as readonly Record<string, unknown>[];
  }

  describe('agent_hitl_interrupt', () => {
    it('stops the turn on a plain single pause and leaves the bubble text alone', () => {
      const history = applyChatStreamFrame(
        [{ ...pendingAssistant(), content: 'partial answer' }],
        frame(SocketMessageType.AgentHitlInterrupt, {
          response_metadata: {
            node_name: 'approve_delete',
            thread_id: 'thread-1',
            hitl_interrupt: { tool_name: 'delete_file', tool_call_id: 'call-1', action_label: 'Delete report.pdf' },
          },
        }),
        CONTEXT,
      );

      expect(history[0]?.isStreaming).toBe(false);
      expect(history[0]?.isLoading).toBe(false);
      // Overwriting content would leave a "requires approval" line in the
      // bubble after the user resumes and the real answer streams in.
      expect(history[0]?.content).toBe('partial answer');
      expect(history[0]?.threadId).toBe('thread-1');
    });

    it('leaves hitlInterrupts UNSET for a single pause so resume stays sequential', () => {
      // The consumer reads the array's mere presence as "parallel" and switches
      // to the hitl_decisions resume shape; populating it here would misroute a
      // pause the backend expects to answer with a single hitl_action.
      const history = applyChatStreamFrame(
        [pendingAssistant()],
        frame(SocketMessageType.AgentHitlInterrupt, {
          response_metadata: { hitl_interrupt: { tool_name: 'delete_file' } },
        }),
        CONTEXT,
      );

      expect(history[0]?.hitlInterrupts).toBeUndefined();
      expect(history[0]?.hitlInterrupt).toMatchObject({ tool_name: 'delete_file', resume_strategy: 'single' });
    });

    it('assembles a single pause from BOTH the top-level and nested fields', () => {
      // Reading only one of the two loses either the routing fields or the tool
      // detail the approval card renders.
      const history = applyChatStreamFrame(
        [pendingAssistant()],
        frame(SocketMessageType.AgentHitlInterrupt, {
          response_metadata: {
            node_name: 'guard',
            available_actions: ['approve'],
            edit_state_key: 'draft',
            interrupt_id: 'top-level-id',
            hitl_interrupt: { tool_name: 'send_email', guardrail_type: 'sensitive_tool', tool_call_id: 'call-9' },
          },
        }),
        CONTEXT,
      );

      expect(history[0]?.hitlInterrupt).toMatchObject({
        node_name: 'guard',
        available_actions: ['approve'],
        edit_state_key: 'draft',
        interrupt_id: 'top-level-id',
        tool_name: 'send_email',
        guardrail_type: 'sensitive_tool',
        tool_call_id: 'call-9',
      });
    });

    it('KEEPS streaming for a fan-out child and accumulates its siblings', () => {
      // Siblings are still running. Flipping isStreaming off collapses the live
      // thinking view and hides every sub-agent that has not rendered a card of
      // its own — including ones that finished without pausing.
      const childFrame = (name: string, thread: string, call: string) =>
        frame(SocketMessageType.AgentHitlInterrupt, {
          response_metadata: {
            metadata: { parent_agent_name: name, child_thread_id: thread },
            hitl_interrupt: { tool_call_id: call },
          },
        });

      let history = applyChatStreamFrame([{ ...pendingAssistant(), isStreaming: false }], childFrame('planner', 't-a', 'c-a'), CONTEXT);
      history = applyChatStreamFrame(history, childFrame('planner', 't-b', 'c-b'), CONTEXT);

      // Re-armed even though the parent's park-by-return had already stopped it.
      expect(history[0]?.isStreaming).toBe(true);
      expect(history[0]?.isRegenerating).toBe(false);
      expect(interruptsOf(history)).toHaveLength(2);
      expect(interruptsOf(history).map((entry) => entry['thread_id'])).toEqual(['t-a', 't-b']);
    });

    it('does not park the message on whichever child paused last', () => {
      // A child resumes on its OWN thread, carried per entry. Writing it to
      // msg.threadId would misroute the parent's resume.
      const history = applyChatStreamFrame(
        [{ ...pendingAssistant(), threadId: 'parent-thread' }],
        frame(SocketMessageType.AgentHitlInterrupt, {
          response_metadata: {
            metadata: { parent_agent_name: 'planner', child_thread_id: 'child-thread', thread_id: 'child-thread' },
            hitl_interrupt: { tool_call_id: 'c-1' },
          },
        }),
        CONTEXT,
      );

      expect(history[0]?.threadId).toBe('parent-thread');
      expect(interruptsOf(history)[0]?.['thread_id']).toBe('child-thread');
    });

    it('keeps streaming for an in-process parallel aggregate and populates the array', () => {
      // N paused sub-agents in ONE frame, each labelled with its parent but
      // with no child thread — so it is not the fan-out shape, yet the run is
      // just as much still active.
      const history = applyChatStreamFrame(
        [pendingAssistant()],
        frame(SocketMessageType.AgentHitlInterrupt, {
          response_metadata: {
            hitl_interrupts: [
              { parent_agent_name: 'researcher', tool_call_id: 'c-1' },
              { parent_agent_name: 'writer', tool_call_id: 'c-2' },
            ],
          },
        }),
        CONTEXT,
      );

      expect(history[0]?.isStreaming).toBe(true);
      expect(interruptsOf(history).map((entry) => entry['tool_call_id'])).toEqual(['c-1', 'c-2']);
      // The singular field tracks the first still-pending entry.
      expect(history[0]?.hitlInterrupt).toMatchObject({ tool_call_id: 'c-1' });
    });

    it('stops the turn for a backend aggregate whose entries name no parent', () => {
      // Same array shape, but nothing is running behind it — this must behave
      // like a plain pause, which is why the check is on parent_agent_name
      // rather than on the array's presence.
      const history = applyChatStreamFrame(
        [pendingAssistant()],
        frame(SocketMessageType.AgentHitlInterrupt, {
          response_metadata: { hitl_interrupts: [{ tool_call_id: 'c-1' }] },
        }),
        CONTEXT,
      );

      expect(history[0]?.isStreaming).toBe(false);
      expect(interruptsOf(history)).toHaveLength(1);
    });

    it('produces entries the resume path can route by tool_call_id', () => {
      // The contract deriveHitlChildThreadId reads: match on tool_call_id, then
      // take thread_id / child_thread_id.
      const history = applyChatStreamFrame(
        [pendingAssistant()],
        frame(SocketMessageType.AgentHitlInterrupt, {
          response_metadata: {
            metadata: { parent_agent_name: 'planner', child_thread_id: 'child-7' },
            hitl_interrupt: { tool_call_id: 'call-7' },
          },
        }),
        CONTEXT,
      );

      const entry = interruptsOf(history).find((item) => item['tool_call_id'] === 'call-7');
      expect(entry?.['thread_id']).toBe('child-7');
      expect(entry?.['child_thread_id']).toBe('child-7');
    });
  });

  describe('agent_requires_confirmation', () => {
    it('keeps the bubble streaming in mono chat and releases it otherwise', () => {
      const confirmation = frame(SocketMessageType.AgentRequiresConfirmation, { content: 'Show more' });

      const mono = applyChatStreamFrame([pendingAssistant()], confirmation, { ...CONTEXT, isMonoChatting: true });
      const multi = applyChatStreamFrame([pendingAssistant()], confirmation, { ...CONTEXT, isMonoChatting: false });

      expect(mono[0]?.isStreaming).toBe(true);
      expect(multi[0]?.isStreaming).toBe(false);
      expect(mono[0]?.isLoading).toBe(false);
    });

    it('labels the button from the frame and falls back to Continue', () => {
      const withLabel = applyChatStreamFrame(
        [pendingAssistant()],
        frame(SocketMessageType.AgentRequiresConfirmation, { content: 'Show more' }),
        CONTEXT,
      );
      const without = applyChatStreamFrame(
        [pendingAssistant()],
        frame(SocketMessageType.AgentRequiresConfirmation),
        CONTEXT,
      );

      expect(withLabel[0]?.requiresConfirmation?.buttonText).toBe('Show more');
      expect(without[0]?.requiresConfirmation?.buttonText).toBe('Continue');
      expect(without[0]?.requiresConfirmation?.message).toContain('Token limit reached');
    });

    it('keeps the thread the earlier frames of this message established', () => {
      // Blanking it would strand the continue request with nowhere to resume.
      const history = applyChatStreamFrame(
        [{ ...pendingAssistant(), threadId: 'thread-earlier' }],
        frame(SocketMessageType.AgentRequiresConfirmation),
        CONTEXT,
      );

      expect(history[0]?.threadId).toBe('thread-earlier');
    });
  });

  describe('mcp_authorization_required', () => {
    const authFrame = (metadata: Record<string, unknown>) =>
      frame(SocketMessageType.McpAuthorizationRequired, {
        content: 'Authorization required.',
        response_metadata: { tool_run_id: 'mcp-1', tool_name: 'Jira MCP', server_url: 'https://mcp.example', ...metadata },
      });

    function outputs(history: readonly ChatMessage[]): Record<string, unknown> {
      return (((history[0]?.toolActions ?? [])[0] as ToolAction | undefined)?.['toolOutputs'] ?? {}) as Record<
        string,
        unknown
      >;
    }

    it('asks for action when the server advertised an authorization server', () => {
      const history = applyChatStreamFrame(
        [pendingAssistant()],
        authFrame({ authorization_servers: ['https://auth.example'] }),
        CONTEXT,
      );
      const action = (history[0]?.toolActions ?? [])[0] as ToolAction;

      expect(action.status).toBe('action_required');
      expect(action['content']).toContain('Authorization servers: https://auth.example');
      // Nothing is in flight: the user has to act.
      expect(history[0]?.isStreaming).toBe(false);
      expect(history[0]?.isLoading).toBe(false);
    });

    it('errors instead when the server advertised none', () => {
      // There is no authorization to start, so an action_required card would be
      // a button that cannot do anything.
      const history = applyChatStreamFrame([pendingAssistant()], authFrame({ status: 403 }), CONTEXT);
      const action = (history[0]?.toolActions ?? [])[0] as ToolAction;

      expect(action.status).toBe('error');
      expect(action['content']).toContain('403: Authorization error in "Jira MCP" toolkit.');
    });

    it('stores the token under the key the backend will look it up by', () => {
      // A wrong key stores a token the toolkit never finds, so the user is
      // asked to authorize again on every single call.
      const prebuilt = applyChatStreamFrame(
        [pendingAssistant()],
        authFrame({ authorization_servers: ['https://auth.example'], toolkit_type: 'mcp_github' }),
        CONTEXT,
      );
      expect(outputs(prebuilt)['server_url']).toBe('mcp_github');

      const composite = applyChatStreamFrame(
        [pendingAssistant()],
        authFrame({
          resource_metadata: { authorization_servers: ['https://auth.example'], configuration_uuid: 'cfg-1' },
        }),
        CONTEXT,
      );
      expect(outputs(composite)['server_url']).toBe('cfg-1:https://auth.example');

      const sharepoint = applyChatStreamFrame(
        [pendingAssistant()],
        authFrame({ resource_metadata: { authorization_servers: ['https://auth.example'], resource_name: 'SharePoint' } }),
        CONTEXT,
      );
      expect(outputs(sharepoint)['server_url']).toBe('https://auth.example');

      const plain = applyChatStreamFrame(
        [pendingAssistant()],
        authFrame({ authorization_servers: ['https://auth.example'], toolkit_type: 'mcp' }),
        CONTEXT,
      );
      expect(outputs(plain)['server_url']).toBe('https://mcp.example');
    });

    it('updates the existing card on a repeat rather than stacking a second one', () => {
      let history = applyChatStreamFrame([pendingAssistant()], authFrame({ status: 403 }), CONTEXT);
      history = applyChatStreamFrame(history, authFrame({ authorization_servers: ['https://auth.example'] }), CONTEXT);

      expect(history[0]?.toolActions).toHaveLength(1);
      expect(((history[0]?.toolActions ?? [])[0] as ToolAction).status).toBe('action_required');
    });
  });
});
