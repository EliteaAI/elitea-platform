import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetConfigForTests } from '@/shared/config/get-config';

import type { FullNotificationMeta } from '../api/normalize';
import { parseNotificationMessage, resolveNotificationHref } from './routes';

function base(): string {
  return `${window.location.protocol}//${window.location.host}`;
}

const globals = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe('resolveNotificationHref', () => {
  it('personal_access_token_expiring: settings/tokens, no project prefix (notification.helpers.js:14-15)', () => {
    expect(resolveNotificationHref('personal_access_token_expiring', undefined, '7')).toBe(`${base()}/settings/tokens`);
  });

  it('chat_user_added: /{projectId}/chat with no conversation query when meta is absent', () => {
    expect(resolveNotificationHref('chat_user_added', undefined, '7')).toBe(`${base()}/7/chat`);
  });

  it('chat_user_added: appends ?conversation= when meta.conversationId is present', () => {
    const meta: FullNotificationMeta = { conversationId: 'c1' };
    expect(resolveNotificationHref('chat_user_added', meta, '7')).toBe(`${base()}/7/chat?conversation=c1`);
  });

  it('chat_user_added: appends &message_id= when both conversationId and messageId are present', () => {
    const meta: FullNotificationMeta = { conversationId: 'c1', messageId: 'm1' };
    expect(resolveNotificationHref('chat_user_added', meta, '7')).toBe(`${base()}/7/chat?conversation=c1&message_id=m1`);
  });

  it('chat_user_mentioned: same shape as chat_user_added', () => {
    const meta: FullNotificationMeta = { conversationId: 'c1' };
    expect(resolveNotificationHref('chat_user_mentioned', meta, '7')).toBe(`${base()}/7/chat?conversation=c1`);
  });

  it('index_data_changed: null when meta.toolkitId is absent', () => {
    expect(resolveNotificationHref('index_data_changed', undefined, '7')).toBeNull();
  });

  it('index_data_changed: /{projectId}/toolkits/indexes/{toolkitId}', () => {
    const meta: FullNotificationMeta = { toolkitId: 't1' };
    expect(resolveNotificationHref('index_data_changed', meta, '7')).toBe(`${base()}/7/toolkits/indexes/t1`);
  });

  it('index_data_changed: appends ?index_name= URL-encoded when present', () => {
    const meta: FullNotificationMeta = { toolkitId: 't1', indexName: 'my index' };
    expect(resolveNotificationHref('index_data_changed', meta, '7')).toBe(`${base()}/7/toolkits/indexes/t1?index_name=my%20index`);
  });

  it('bucket_expiration_warning: /{projectId}/artifacts with no query when bucketName absent', () => {
    expect(resolveNotificationHref('bucket_expiration_warning', undefined, '7')).toBe(`${base()}/7/artifacts`);
  });

  it('bucket_expiration_warning: appends ?bucket= URL-encoded when present', () => {
    const meta: FullNotificationMeta = { bucketName: 'my bucket' };
    expect(resolveNotificationHref('bucket_expiration_warning', meta, '7')).toBe(`${base()}/7/artifacts?bucket=my%20bucket`);
  });

  it('agent_unpublished: null when appId or versionId is missing', () => {
    expect(resolveNotificationHref('agent_unpublished', {}, '7')).toBeNull();
    expect(resolveNotificationHref('agent_unpublished', { sourceApplicationId: 'a1' }, '7')).toBeNull();
  });

  it('agent_unpublished: builds /{projectId}/agents/all/{appId}/{versionId}?viewMode=owner', () => {
    const meta: FullNotificationMeta = { sourceApplicationId: 'a1', sourceVersionId: 'v1' };
    expect(resolveNotificationHref('agent_unpublished', meta, '7')).toBe(`${base()}/7/agents/all/a1/v1?viewMode=owner`);
  });

  it('agent_unpublished: prefers meta.projectId over the notification project id (notification.helpers.js:44)', () => {
    const meta: FullNotificationMeta = { sourceApplicationId: 'a1', sourceVersionId: 'v1', projectId: '99' };
    expect(resolveNotificationHref('agent_unpublished', meta, '7')).toBe(`${base()}/99/agents/all/a1/v1?viewMode=owner`);
  });

  it('returns null for an unmapped event type (default branch)', () => {
    expect(resolveNotificationHref('rates', undefined, '7')).toBeNull();
    expect(resolveNotificationHref('comments', undefined, '7')).toBeNull();
  });

  it('includes vite_base_uri in the base URL outside dev mode', () => {
    vi.stubEnv('DEV', false);
    globals['elitea_ui_config'] = {
      vite_server_url: 'https://elitea.example',
      // Deliberately trailing-slash, matching R1/F3's own canonical fixture
      // value (`src/routes/__tests__/projectSwitcher.test.tsx`'s
      // `setValidConfig()`). `notification.helpers.js:11`'s baseline
      // concatenation (`${protocol}//${host}${getBasename()}` + a
      // leading-slash route path) produces a double slash whenever
      // `vite_base_uri` itself ends in one — reproduced verbatim (N4), not
      // normalized away, since this port's `absoluteBase()` uses the exact
      // same naive concatenation the baseline does.
      vite_base_uri: '/app/',
      vite_public_project_id: '1',
    };
    resetConfigForTests();
    expect(resolveNotificationHref('personal_access_token_expiring', undefined, '7')).toBe(`${base()}/app//settings/tokens`);
    delete globals['elitea_ui_config'];
  });
});

describe('parseNotificationMessage', () => {
  it('returns [] for undefined/empty message', () => {
    expect(parseNotificationMessage(undefined)).toEqual([]);
    expect(parseNotificationMessage('')).toEqual([]);
  });

  it('returns a single non-link segment for plain text', () => {
    expect(parseNotificationMessage('hello world')).toEqual([{ text: 'hello world' }]);
  });

  it('parses a single [text]() link at the start', () => {
    expect(parseNotificationMessage('[my link]() rest')).toEqual([
      { text: 'my link', isLink: true },
      { text: ' rest' },
    ]);
  });

  it('parses a link in the middle, preserving surrounding text', () => {
    expect(parseNotificationMessage('before [mid]() after')).toEqual([
      { text: 'before ' },
      { text: 'mid', isLink: true },
      { text: ' after' },
    ]);
  });

  it('parses multiple links', () => {
    expect(parseNotificationMessage('[a]() and [b]()')).toEqual([
      { text: 'a', isLink: true },
      { text: ' and ' },
      { text: 'b', isLink: true },
    ]);
  });

  it('parses a link with a non-empty href payload (href ignored, only text captured)', () => {
    expect(parseNotificationMessage('[text](https://ignored)')).toEqual([{ text: 'text', isLink: true }]);
  });
});
