/**
 * The socket-to-facade translation, tested.
 *
 * These two functions are the whole of what the port changed about how a
 * generation starts and how its progress arrives. Everything else in
 * hooks/useSocket.js is plumbing around them, and everything else in the
 * bundle consumes their output unchanged — so a mistake here reaches a user
 * as a generation that refuses, or as one that runs and shows nothing.
 *
 * Run with: node --test src/hooks/useSocket.test.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SocketMessageType,
  invokeBodyFromSocketPayload,
  messagesFromPoll,
} from './useSocket.js';

// The payload DeepWikiApp actually builds, trimmed to the fields the
// translation reads. Copied from the emit site rather than invented, because
// a test written against an invented shape proves the translation agrees with
// the test and nothing else.
function socketPayload(overrides = {}) {
  return {
    project_id: 7,
    stream_id: 'stream-1',
    message_id: 'message-1',
    toolkit_config: {
      type: 'wikis',
      toolkit_name: 'Wikis',
      toolkit_id: 11,
      settings: {
        toolkit_configuration_code_toolkit: 42,
        toolkit_configuration_llm_model: 'gpt-4o',
        toolkit_configuration_max_tokens: 64000,
        toolkit_configuration_repository: 'octocat/hello-world',
        toolkit_configuration_active_branch: 'main',
        ...overrides.settings,
      },
    },
    tool_name: 'generate_wiki',
    tool_params: { query: 'GO', planner_type: 'cluster', exclude_tests: null },
    llm_model: 'gpt-4o',
    llm_settings: { max_tokens: 64000, model_name: 'gpt-4o' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// the invoke body
// ---------------------------------------------------------------------------

test('code_toolkit is sent as the configuration ID, not the expanded settings', () => {
  const { body } = invokeBodyFromSocketPayload(socketPayload());
  // An INTEGER. The facade refuses an expanded object, and rightly: that
  // would be the client choosing which credential the provider clones with.
  assert.equal(body.configuration.parameters.code_toolkit, 42);
});

test('the settings the facade needs are carried, and nothing else is', () => {
  const { body } = invokeBodyFromSocketPayload(socketPayload());
  const parameters = body.configuration.parameters;
  assert.equal(parameters.llm_model, 'gpt-4o');
  assert.equal(parameters.max_tokens, 64000);
  assert.equal(parameters.repository, 'octocat/hello-world');
  assert.equal(parameters.active_branch, 'main');

  // llm_settings is NEVER sent. The facade writes that block itself, with a
  // short-lived project-bound token and the platform's own origin, and it
  // discards whatever a client supplies. Sending one would be dead weight
  // that reads like a working credential path.
  assert.equal(parameters.llm_settings, undefined);
});

test('tool parameters pass through, and null ones are dropped', () => {
  const { body } = invokeBodyFromSocketPayload(socketPayload());
  assert.equal(body.parameters.query, 'GO');
  assert.equal(body.parameters.planner_type, 'cluster');
  // exclude_tests is null for the agentic planner. The engine's merge rule
  // treats a falsy tool parameter as "do not override", so sending it is the
  // same as not sending it.
  assert.ok(!('exclude_tests' in body.parameters));
});

test('a toolkit with no code_toolkit refuses with a message that says what to do', () => {
  assert.throws(
    () =>
      invokeBodyFromSocketPayload(
        socketPayload({ settings: { toolkit_configuration_code_toolkit: undefined } })
      ),
    /code_toolkit/
  );
});

test('a non-numeric code_toolkit is refused rather than sent as a string', () => {
  // The facade types this field as an integer and rejects a string, so
  // catching it here turns a confusing 400 into a message about settings.
  assert.throws(
    () =>
      invokeBodyFromSocketPayload(
        socketPayload({ settings: { toolkit_configuration_code_toolkit: 'github-toolkit' } })
      ),
    /code_toolkit/
  );
});

test('the un-prefixed setting names are read too', () => {
  // Toolkit settings arrive under both spellings depending on how they were
  // saved; the legacy resolver read both, and so does this.
  const { body } = invokeBodyFromSocketPayload(
    socketPayload({
      settings: { toolkit_configuration_code_toolkit: undefined, code_toolkit: 9 },
    })
  );
  assert.equal(body.configuration.parameters.code_toolkit, 9);
});

test('the project and tool are taken from the payload', () => {
  const request = invokeBodyFromSocketPayload(socketPayload());
  assert.equal(request.projectId, 7);
  assert.equal(request.toolName, 'generate_wiki');
});

// ---------------------------------------------------------------------------
// poll → messages
// ---------------------------------------------------------------------------

const context = { messageId: 'message-1', streamId: 'stream-1' };

test('custom events become thinking steps, in order', () => {
  const messages = messagesFromPoll(
    {
      status: 'InProgress',
      custom_events: [
        { data: { message: 'Cloning repository' } },
        { data: { message: 'Indexing 128 files' } },
      ],
    },
    context
  );
  assert.deepEqual(
    messages.map((m) => m.type),
    [SocketMessageType.AgentThinkingStep, SocketMessageType.AgentThinkingStep]
  );
  assert.deepEqual(
    messages.map((m) => m.content),
    ['Cloning repository', 'Indexing 128 files']
  );
  // The ids are echoed from the emit, which is what makes a synthesised
  // message indistinguishable from a pushed one at the point it is consumed.
  assert.equal(messages[0].message_id, 'message-1');
  assert.equal(messages[0].stream_id, 'stream-1');
});

test('an in-progress poll with no events produces no messages', () => {
  // Not an empty thinking step, and not a spurious response. A poll that
  // found nothing new must be silent, or the panel fills with blanks.
  assert.deepEqual(messagesFromPoll({ status: 'InProgress' }, context), []);
});

test('completion carries the result as an agent response', () => {
  const messages = messagesFromPoll(
    { status: 'Completed', result: '[{"type":"message"}]' },
    context
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, SocketMessageType.AgentResponse);
  assert.equal(messages[0].content, '[{"type":"message"}]');
});

test('a terminal error keeps its category, not just its text', () => {
  const messages = messagesFromPoll(
    {
      status: 'Error',
      result: '[{"type":"error","data":"boom"}]',
      error_category: 'runtime_error',
      error_type: 'RuntimeError',
    },
    context
  );
  assert.equal(messages[0].type, SocketMessageType.Error);
  // The handlers read error_category to decide what to show. Flattening the
  // error to a string would lose it, and every failure would read the same.
  assert.equal(messages[0].response_metadata.error_category, 'runtime_error');
  assert.equal(messages[0].response_metadata.error_type, 'RuntimeError');
});

test('a stopped invocation is terminal too', () => {
  // Stopped is what a cancel and what a restart-reconciled invocation both
  // become. Treating it as still running is a spinner that never stops.
  const messages = messagesFromPoll({ status: 'Stopped', result: 'cancelled' }, context);
  assert.equal(messages[0].type, SocketMessageType.Error);
});

test('events drained on the SAME poll as the terminal status are all delivered', () => {
  // The last poll usually carries both. Returning only the terminal message
  // would silently drop the final progress lines, which are the ones that say
  // what the generation actually produced.
  const messages = messagesFromPoll(
    {
      status: 'Completed',
      result: 'done',
      custom_events: [{ data: { message: 'Publishing wiki' } }],
    },
    context
  );
  assert.deepEqual(
    messages.map((m) => m.type),
    [SocketMessageType.AgentThinkingStep, SocketMessageType.AgentResponse]
  );
});

test('an event with no message is skipped rather than delivered empty', () => {
  const messages = messagesFromPoll(
    { status: 'InProgress', custom_events: [{ data: {} }, { data: { message: 'ok' } }] },
    context
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, 'ok');
});
