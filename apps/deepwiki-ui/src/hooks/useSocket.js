/**
 * The invocation channel — socket.io's interface, the facade's transport.
 *
 * WHAT THIS REPLACES, AND WHY IT IS NOT A SOCKET ANY MORE.
 *
 * The legacy SPA started a generation by emitting `test_toolkit_tool` on the
 * platform's socket.io server and listening for streamed progress. The Go
 * platform serves no socket.io at all: it never has, and the chat path it
 * would have shared moved to Server-Sent Events. So a vendored bundle that
 * kept emitting would connect to nothing, fail quietly, and show a spinner
 * that never resolves — which is worse than an error.
 *
 * The facade (ADR-0022 decision 5) offers exactly the surface this needs:
 * `POST .../invoke` accepts and returns an invocation id, `GET
 * .../invocations/...` returns status plus the events accumulated since the
 * last poll, and `DELETE` cancels. Progress arrives by polling instead of
 * being pushed; everything else is the same information.
 *
 * WHY THE INTERFACE IS UNCHANGED. `useManualSocket`, `sioEvents`,
 * `SocketMessageType`, `emitSocketEvent` and `getSocketId` are all still
 * exported with their original shapes, and this module synthesises the same
 * message objects the components' handlers already parse. Two consumers read
 * this — DeepWikiApp's generate path and ChatDrawer's ask path, together some
 * 7,600 lines — and rewriting their event handling to a new shape would be a
 * large diff whose correctness nobody could check by reading it. Keeping the
 * seam means the change is confined to this file.
 *
 * READ-ONCE EVENTS. A poll returns what accumulated since the previous one
 * and clears it, which is the provider's contract and the P0 fixtures pin it.
 * That is why exactly one poller runs per invocation: a second one would
 * consume events the first will never see.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** How often a running invocation is polled, in milliseconds. */
const POLL_INTERVAL_MS = 2000;

/**
 * Socket.io event names.
 *
 * Kept verbatim so the call sites do not change. `test_toolkit_tool` is now
 * the only one that does anything: the room events were socket.io's way of
 * isolating one browser tab's stream from another's, and an invocation id
 * does that by construction.
 */
export const sioEvents = {
  chat_predict: 'chat_predict',
  chat_leave_rooms: 'chat_leave_rooms',
  chat_enter_room: 'chat_enter_room',
  socket_validation_error: 'socket_validation_error',
  test_toolkit_tool: 'test_toolkit_tool',
  test_toolkit_enter_room: 'test_toolkit_enter_room',
  test_toolkit_leave_room: 'test_toolkit_leave_room',
  application_predict: 'application_predict',
};

/** Message types the platform used to push. Synthesised here from polls. */
export const SocketMessageType = {
  StartTask: 'start_task',
  Chunk: 'chunk',
  AIMessageChunk: 'AIMessageChunk',
  AgentResponse: 'agent_response',
  AgentStart: 'agent_start',
  AgentToolStart: 'agent_tool_start',
  AgentToolEnd: 'agent_tool_end',
  AgentToolError: 'agent_tool_error',
  AgentLlmStart: 'agent_llm_start',
  AgentLlmChunk: 'agent_llm_chunk',
  AgentLlmEnd: 'agent_llm_end',
  AgentThinkingStep: 'agent_thinking_step',
  AgentThinkingStepUpdate: 'agent_thinking_step_update',
  AgentException: 'agent_exception',
  References: 'references',
  Error: 'error',
  LlmError: 'llm_error',
};

/** The facade's prefix. Same-origin: this bundle is served by elitea-main. */
const FACADE = '/api/v2/deepwiki';

/** The provider's toolkit and tool for a wiki generation. */
const WIKI_TOOLKIT = 'Wikis';

/**
 * Read the code-toolkit configuration id out of a toolkit's settings.
 *
 * The facade expects `code_toolkit` as an INTEGER — a configuration id in the
 * caller's project, which it expands from the vault. It refuses an already
 * expanded object, so passing the settings through wholesale would be
 * rejected, and rightly: that would be the client choosing which credential
 * the provider clones with.
 */
function codeToolkitId(settings) {
  const raw =
    settings?.toolkit_configuration_code_toolkit ??
    settings?.code_toolkit ??
    settings?.toolkit_configuration_code_repository ??
    settings?.code_repository ??
    null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function settingValue(settings, ...names) {
  for (const name of names) {
    const value = settings?.[`toolkit_configuration_${name}`] ?? settings?.[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * Translate the socket payload the components already build into the facade's
 * invoke body.
 *
 * The two are close but not identical, and the differences are the point of
 * the port: the facade takes a configuration REFERENCE where the socket
 * payload carried expanded settings, and it never accepts `llm_settings` from
 * a client — it writes that block itself, with a short-lived project-bound
 * token and the platform's own origin.
 */
export function invokeBodyFromSocketPayload(payload) {
  const settings = payload?.toolkit_config?.settings || {};
  const toolkitId = codeToolkitId(settings);
  if (!toolkitId) {
    throw new Error(
      'This toolkit has no `code_toolkit` setting, so there is no repository ' +
        'configuration to generate from. Set it in the toolkit settings first.'
    );
  }

  const parameters = {
    code_toolkit: toolkitId,
  };
  const llmModel = payload?.llm_model ?? settingValue(settings, 'llm_model');
  if (llmModel) parameters.llm_model = llmModel;
  const maxTokens = payload?.llm_settings?.max_tokens ?? settingValue(settings, 'max_tokens');
  if (maxTokens) parameters.max_tokens = Number(maxTokens);
  const embedding = settingValue(settings, 'embedding_model');
  if (embedding !== undefined) parameters.embedding_model = embedding;
  const repository = settingValue(settings, 'repository', 'repo');
  if (repository) parameters.repository = repository;
  const branch = settingValue(settings, 'active_branch', 'branch', 'base_branch');
  if (branch) parameters.active_branch = branch;

  // Tool parameters are passed through untouched. `null` values are dropped:
  // the engine's merge rule treats a falsy tool parameter as "do not
  // override", so sending one is the same as not sending it and only makes
  // the payload harder to read.
  const toolParameters = {};
  for (const [key, value] of Object.entries(payload?.tool_params || {})) {
    if (value !== null && value !== undefined) toolParameters[key] = value;
  }

  return {
    body: { configuration: { parameters }, parameters: toolParameters },
    toolName: payload?.tool_name || 'generate_wiki',
    projectId: payload?.project_id,
  };
}

/**
 * Build the message objects a component's handler expects from one poll.
 *
 * The handlers were written against a push stream, so they key on `type` and
 * read `content`, `message_id` and `stream_id`. Those three are echoed from
 * the payload the caller emitted, which is what makes a synthesised message
 * indistinguishable from a pushed one at the point it is consumed.
 */
export function messagesFromPoll(poll, context) {
  const base = {
    message_id: context.messageId,
    stream_id: context.streamId,
    response_metadata: {},
  };
  const messages = [];

  // Progress. `custom_events` is read-once and arrives only on the poll that
  // drained it, so every event must be turned into a message here or it is
  // gone.
  for (const event of poll?.custom_events || []) {
    const text = event?.data?.message;
    if (!text) continue;
    messages.push({ ...base, type: SocketMessageType.AgentThinkingStep, content: text });
  }

  const status = poll?.status;
  if (status === 'Completed') {
    messages.push({
      ...base,
      type: SocketMessageType.AgentResponse,
      content: poll?.result ?? '',
      response_metadata: { status },
    });
  } else if (status === 'Error' || status === 'Stopped') {
    messages.push({
      ...base,
      type: SocketMessageType.Error,
      // The handlers parse a JSON error body out of `content`, so the shape
      // the provider already returns is passed through rather than flattened
      // to a string that would lose error_category.
      content: poll?.result ?? poll?.message ?? 'The generation failed.',
      response_metadata: {
        status,
        error_category: poll?.error_category,
        error_type: poll?.error_type,
      },
    });
  }
  return messages;
}

/** A terminal poll needs no follow-up. */
function isTerminal(poll) {
  return poll?.status !== undefined && !['Started', 'InProgress'].includes(poll.status);
}

/**
 * The one live invocation, and the poller draining it.
 *
 * Module scope, like the socket instance it replaces, and for the same
 * reason: the components subscribe and emit from different callbacks and
 * expect one channel between them. Exactly ONE poller may run — events are
 * read-once, so a second poller would consume events the first never sees.
 */
const channel = {
  handlers: new Set(),
  timer: null,
  current: null, // { projectId, toolName, invocationId, streamId, messageId }
};

function deliver(message) {
  for (const handler of channel.handlers) {
    try {
      handler(message);
    } catch (error) {
      console.error('[DeepWiki] an invocation handler threw', error);
    }
  }
}

function stopPolling() {
  if (channel.timer) {
    clearInterval(channel.timer);
    channel.timer = null;
  }
  channel.current = null;
}

async function pollOnce() {
  const active = channel.current;
  if (!active) return;

  let response;
  try {
    response = await fetch(
      `${FACADE}/invocations/${active.projectId}/${WIKI_TOOLKIT}/${active.toolName}/${active.invocationId}`,
      { headers: { Accept: 'application/json' }, credentials: 'same-origin' }
    );
  } catch (error) {
    // A dropped poll is not a failed generation: the work runs on the
    // provider and the invocation is durable. Keep polling and say nothing —
    // reporting every transient network blip as an error is how a working
    // generation ends up looking broken.
    console.warn('[DeepWiki] poll failed, will retry', error);
    return;
  }

  if (response.status === 404) {
    // The invocation is gone. It was pruned, or it belonged to a service that
    // has since restarted and reconciled it. Either way there is nothing left
    // to wait for, and silence would be a spinner that never stops.
    deliver({
      message_id: active.messageId,
      stream_id: active.streamId,
      type: SocketMessageType.Error,
      content: 'The generation is no longer tracked by the server.',
      response_metadata: { status: 'Error' },
    });
    stopPolling();
    return;
  }
  if (!response.ok) {
    console.warn('[DeepWiki] poll returned', response.status);
    return;
  }

  const poll = await response.json();
  for (const message of messagesFromPoll(poll, active)) deliver(message);
  if (isTerminal(poll)) stopPolling();
}

/**
 * Start a generation and begin polling it.
 *
 * Returns false rather than throwing, because the call sites treat the socket
 * emit's return value as "was it sent" and already handle false.
 */
async function startInvocation(payload) {
  let request;
  try {
    request = invokeBodyFromSocketPayload(payload);
  } catch (error) {
    deliver({
      message_id: payload?.message_id,
      stream_id: payload?.stream_id,
      type: SocketMessageType.Error,
      content: error.message,
      response_metadata: { status: 'Error' },
    });
    return false;
  }

  // One at a time. The previous poller is stopped first so it cannot drain
  // the new invocation's events into the old invocation's context.
  stopPolling();

  let response;
  try {
    response = await fetch(
      `${FACADE}/tools/${request.projectId}/${WIKI_TOOLKIT}/${request.toolName}/invoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(request.body),
      }
    );
  } catch (error) {
    deliver({
      message_id: payload?.message_id,
      stream_id: payload?.stream_id,
      type: SocketMessageType.Error,
      content: `Could not reach the server: ${error.message}`,
      response_metadata: { status: 'Error' },
    });
    return false;
  }

  if (!response.ok) {
    let detail = `The server refused the request (${response.status}).`;
    try {
      const body = await response.json();
      if (body?.error) detail = body.error;
    } catch {
      // A non-JSON error body is not worth surfacing raw.
    }
    deliver({
      message_id: payload?.message_id,
      stream_id: payload?.stream_id,
      type: SocketMessageType.Error,
      content: detail,
      response_metadata: { status: 'Error' },
    });
    return false;
  }

  const accepted = await response.json();
  const invocationId = accepted?.invocation_id;
  if (!invocationId) {
    deliver({
      message_id: payload?.message_id,
      stream_id: payload?.stream_id,
      type: SocketMessageType.Error,
      content: 'The server accepted the request but returned no invocation id.',
      response_metadata: { status: 'Error' },
    });
    return false;
  }

  channel.current = {
    projectId: request.projectId,
    toolName: request.toolName,
    invocationId,
    streamId: payload?.stream_id,
    messageId: payload?.message_id,
  };

  // The invocation id takes the place of the task id the platform used to
  // push back, so the stop button has something to cancel.
  deliver({
    message_id: payload?.message_id,
    stream_id: payload?.stream_id,
    type: SocketMessageType.StartTask,
    content: '',
    response_metadata: { task_id: invocationId, invocation_id: invocationId },
    task_id: invocationId,
  });

  channel.timer = setInterval(() => {
    void pollOnce();
  }, POLL_INTERVAL_MS);
  // Poll once immediately: a fast tool can be terminal before the first
  // interval elapses, and waiting would show an idle spinner for no reason.
  void pollOnce();
  return true;
}

/** Cancel the running invocation. Exported for the stop button. */
export async function cancelInvocation() {
  const active = channel.current;
  if (!active) return false;
  try {
    const response = await fetch(
      `${FACADE}/invocations/${active.projectId}/${WIKI_TOOLKIT}/${active.toolName}/${active.invocationId}`,
      { method: 'DELETE', credentials: 'same-origin' }
    );
    // Polling continues either way: the cancel is a REQUEST, and the
    // invocation becomes terminal when the provider acts on it. Stopping here
    // would hide the terminal message the components use to settle their UI.
    return response.ok;
  } catch (error) {
    console.warn('[DeepWiki] cancel failed', error);
    return false;
  }
}

/** The id of the invocation currently running, or null. */
export function currentInvocationId() {
  return channel.current?.invocationId ?? null;
}

/**
 * Auto-subscribing hook. Unchanged interface; `connected` is now "is the page
 * able to talk to the facade at all", which it always is when served
 * same-origin, so it reports true rather than tracking a connection that no
 * longer exists.
 */
export function useSocket(event, handler) {
  const [connected] = useState(true);
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!event || !handler) return undefined;
    const wrapper = (data) => handlerRef.current?.(data);
    channel.handlers.add(wrapper);
    return () => {
      channel.handlers.delete(wrapper);
    };
  }, [event, handler]);

  const emit = useCallback(
    (payload) => {
      if (event !== sioEvents.test_toolkit_tool) return false;
      void startInvocation(payload);
      return true;
    },
    [event]
  );

  return { emit, connected };
}

/**
 * Manual hook. Same three functions, same duplicate-subscription guard.
 */
export function useManualSocket(event, handler) {
  const handlerRef = useRef(handler);
  const wrapperRef = useRef(null);
  const isSubscribedRef = useRef(false);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    wrapperRef.current = (data) => handlerRef.current?.(data);
    return () => {
      // A component that unmounts mid-generation must not leave its handler
      // in the set: the poller would keep calling into a dead component.
      if (wrapperRef.current) channel.handlers.delete(wrapperRef.current);
      isSubscribedRef.current = false;
    };
  }, []);

  const subscribe = useCallback(() => {
    if (isSubscribedRef.current || !wrapperRef.current) return;
    channel.handlers.add(wrapperRef.current);
    isSubscribedRef.current = true;
  }, []);

  const unsubscribe = useCallback(() => {
    if (!wrapperRef.current) return;
    channel.handlers.delete(wrapperRef.current);
    isSubscribedRef.current = false;
  }, []);

  const emit = useCallback(
    (payload) => {
      if (event !== sioEvents.test_toolkit_tool) return false;
      void startInvocation(payload);
      return true;
    },
    [event]
  );

  return { subscribe, unsubscribe, emit };
}

/**
 * There is no socket id any more, and nothing may pretend there is.
 *
 * It was passed to the backend so events could be routed back to one browser
 * tab. Polling asks for one invocation by id, so the routing problem does not
 * exist. Returning a made-up value would let a caller believe it had a room.
 */
export function getSocketId() {
  return null;
}

/**
 * The room events are no-ops, and that is the whole translation.
 *
 * Rooms isolated one tab's stream from another's on a shared socket. Each
 * poll names one invocation id, so there is nothing to isolate. `true` is
 * returned because the call sites log a warning on false, and a warning about
 * a concept that no longer exists is noise an operator would chase.
 */
export function emitSocketEvent(eventName, payload) {
  if (eventName === sioEvents.test_toolkit_tool) {
    void startInvocation(payload);
    return true;
  }
  return true;
}

/** Kept for call-site compatibility. There is no socket to disconnect. */
export function disconnectSocket() {
  stopPolling();
}

/**
 * There is no socket object. Callers that reached for `.on`/`.off`/`.emit`
 * get an object that accepts those calls and does nothing, rather than an
 * undefined that throws — but it deliberately does NOT deliver events, so a
 * path still relying on a pushed stream stays visibly broken instead of
 * quietly half-working.
 */
export function getSocket() {
  return {
    connected: false,
    disconnected: true,
    id: null,
    on() {},
    off() {},
    emit() {
      return false;
    },
    connect() {},
    disconnect() {},
  };
}

export default useSocket;
