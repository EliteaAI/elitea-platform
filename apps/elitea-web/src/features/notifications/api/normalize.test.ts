import { describe, expect, it } from 'vitest';

import { normalizeNotification, normalizeNotificationList } from './normalize';
import type { NotificationWire } from './notifications';

const baseWire: NotificationWire = {
  id: 42,
  event_type: 'chat_user_added',
  created_at: '2026-01-01T00:00:00Z',
  is_seen: false,
};

describe('normalizeNotification', () => {
  it('coerces numeric id/project_id to string', () => {
    const result = normalizeNotification({ ...baseWire, project_id: 7 });
    expect(result.id).toBe('42');
    expect(result.projectId).toBe('7');
  });

  it('omits projectId entirely when absent (exactOptionalPropertyTypes-safe)', () => {
    const result = normalizeNotification(baseWire);
    expect('projectId' in result).toBe(false);
  });

  it('carries createdAt/isSeen straight through', () => {
    const result = normalizeNotification(baseWire);
    expect(result.createdAt).toBe('2026-01-01T00:00:00Z');
    expect(result.isSeen).toBe(false);
  });

  it('preserves eventType verbatim, including values outside the known union', () => {
    const result = normalizeNotification({ ...baseWire, event_type: 'some_future_type' });
    expect(result.eventType).toBe('some_future_type');
  });

  it('omits meta entirely when absent', () => {
    const result = normalizeNotification(baseWire);
    expect('meta' in result).toBe(false);
  });

  it('maps every snake_case meta field to its camelCase equivalent', () => {
    const result = normalizeNotification({
      ...baseWire,
      meta: {
        message: 'hi',
        conversation_id: 'c1',
        message_id: 'm1',
        toolkit_id: 't1',
        index_name: 'i1',
        bucket_name: 'b1',
        source_application_id: 'a1',
        source_version_id: 'v1',
        project_id: 'p1',
        reason: 'r1',
        error: 'e1',
        token_name: 'tok',
        rates_count: 3,
        comments_count: 4,
        replies_count: 5,
        prompt_name: 'prompt',
        prompt_id: 'pid',
        prompt_version_id: 'pvid',
        new_level: 2,
        author_name: 'author',
        users: ['u1', 'u2'],
        project_name: 'proj',
        initiator_name: 'init',
        conversation_name: 'conv',
        indexed: 10,
        updated: 20,
        reindex: true,
        initiator: 'schedule',
      },
    });
    expect(result.meta).toEqual({
      message: 'hi',
      conversationId: 'c1',
      messageId: 'm1',
      toolkitId: 't1',
      indexName: 'i1',
      bucketName: 'b1',
      sourceApplicationId: 'a1',
      sourceVersionId: 'v1',
      projectId: 'p1',
      reason: 'r1',
      error: 'e1',
      tokenName: 'tok',
      ratesCount: 3,
      commentsCount: 4,
      repliesCount: 5,
      promptName: 'prompt',
      promptId: 'pid',
      promptVersionId: 'pvid',
      newLevel: 2,
      authorName: 'author',
      users: ['u1', 'u2'],
      projectName: 'proj',
      initiatorName: 'init',
      conversationName: 'conv',
      indexed: 10,
      updated: 20,
      reindex: true,
      initiator: 'schedule',
    });
  });

  it('drops undefined meta fields rather than keeping them as explicit undefined keys', () => {
    const result = normalizeNotification({ ...baseWire, meta: { message: 'hi' } });
    expect(Object.keys(result.meta ?? {})).toEqual(['message']);
  });
});

describe('normalizeNotificationList', () => {
  it('maps every row', () => {
    const result = normalizeNotificationList([baseWire, { ...baseWire, id: 43 }]);
    expect(result.map((n) => n.id)).toEqual(['42', '43']);
  });

  it('returns an empty array for an empty input', () => {
    expect(normalizeNotificationList([])).toEqual([]);
  });
});
