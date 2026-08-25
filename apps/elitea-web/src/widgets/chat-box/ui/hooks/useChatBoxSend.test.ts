/**
 * Regression cover for the execution-contract defect in `useChatBoxSend`.
 *
 * DEFECT — the contract was picked from a page flag no caller sets.
 * `startStreamedExecution` chose
 * `isAgentsPage ? contracts.application : contracts.adhoc`, and the sole
 * `<ChatBox>` render (`pages/chat/index.tsx`) passes no `isAgentsPage`. So
 * `agent.execute.application.v1` was unreachable and EVERY turn — including
 * one addressed to an agent participant — went out as
 * `agent.execute.adhoc.v1`, whose resolver joins on
 * `target_participant.entity_name = 'dummy'` (`internal/db/queries/
 * agent_chat.sql`). An agent participant matches no row, so the route answered
 * `422 unsupported_agent_execution`.
 *
 * The one-line ternary swap alone would not have helped: the two contracts are
 * validated differently in `internal/api/v2/agentexecution/route.go`. The
 * application branch requires `ParticipantID > 0` AND `absentJSON(LLMSettings)`
 * — and `buildStartBody` always emitted an `llm_settings` object — so the
 * application contract would have 422'd on its own body shape.
 */
import { describe, expect, it } from 'vitest';

import { conversationApi } from '@/entities/conversation';

import { buildStartBody, resolveStartContract, resolveTargetParticipant } from './useChatBoxSend';

const agent = { id: 42, entity_name: 'application' };
const pipeline = { id: 43, entity_name: 'pipeline' };
const model = { id: 7, entity_name: 'llm' };

describe('resolveStartContract', () => {
  it('sends an agent turn under the application contract', () => {
    expect(resolveStartContract(agent)).toBe(conversationApi.contracts.application);
    expect(resolveStartContract(pipeline)).toBe(conversationApi.contracts.application);
  });

  it('sends a plain model turn under the ad-hoc contract', () => {
    expect(resolveStartContract(model)).toBe(conversationApi.contracts.adhoc);
    expect(resolveStartContract(undefined)).toBe(conversationApi.contracts.adhoc);
  });
});

describe('resolveTargetParticipant', () => {
  it('prefers the explicit selection', () => {
    expect(resolveTargetParticipant(model, [agent])).toBe(model);
  });

  it('addresses the conversation’s only agent when nothing is selected', () => {
    expect(resolveTargetParticipant(undefined, [model, agent])).toBe(agent);
  });

  it('stays unresolved when the conversation holds more than one agent', () => {
    expect(resolveTargetParticipant(undefined, [agent, pipeline])).toBeUndefined();
  });
});

const commonBody = {
  conversationUuid: 'conv-uuid-1',
  projectId: '1',
  payload: { question: 'hi', question_id: 'q-1' },
  llmSettings: { temperature: 0.7 },
  modelName: 'gpt-4o',
};

describe('buildStartBody', () => {
  it('omits llm_settings entirely for an application turn', () => {
    const body = buildStartBody({ ...commonBody, isApplicationTurn: true, participantId: 42 });
    // `absentJSON(body.LLMSettings)` — a present key, even an empty object,
    // is answered 422.
    expect(body).toBeDefined();
    expect(Object.hasOwn(body ?? {}, 'llm_settings')).toBe(false);
    expect(body?.['participant_id']).toBe(42);
  });

  it('refuses to build an application body with no addressable participant', () => {
    // `ParticipantID <= 0` is an instant 422, so no body is better than one
    // that cannot pass; the caller falls back to the socket instead.
    expect(buildStartBody({ ...commonBody, isApplicationTurn: true, participantId: undefined })).toBeUndefined();
  });

  it('keeps the llm_settings object and the 0 default for an ad-hoc turn', () => {
    const body = buildStartBody({ ...commonBody, isApplicationTurn: false, participantId: undefined });
    expect(body?.['participant_id']).toBe(0);
    expect(body?.['llm_settings']).toEqual({ temperature: 0.7, model_name: 'gpt-4o', stream: true });
  });

  it('encodes project_id as a number, which the route decodes into int64', () => {
    const body = buildStartBody({ ...commonBody, isApplicationTurn: false, participantId: 7 });
    expect(body?.['project_id']).toBe(1);
    expect(body?.['participant_id']).toBe(7);
  });
});
