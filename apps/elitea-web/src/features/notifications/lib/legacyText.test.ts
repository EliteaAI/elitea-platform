import { describe, expect, it } from 'vitest';

import type { FullNotificationMeta } from '../api/normalize';
import { endingText, formatIndexMessage, formatName, leadingText, middleText, parseLegacyInformation } from './legacyText';

describe('leadingText', () => {
  it('interpolates param1/param2 per event type (notificationLegacy.helpers.js:8-20)', () => {
    expect(leadingText('MyToken', '').token_expiring).toBe(
      'Token MyToken will be expired in 5 days. For more details view your ',
    );
    expect(leadingText('L2', '').reward_new_level).toBe("Congratulations! You've got L2 level of prompt expert!");
    expect(leadingText('Alice', 'Bob').chat_user_added).toBe('Alice added Bob to ');
    expect(leadingText('', '').private_project_created).toBe('Project was successfully created');
  });

  it('is undefined for an event type with no leading text', () => {
    expect(leadingText('', '').rates).toBeUndefined();
  });
});

describe('middleText', () => {
  it('is verbatim empty (no event type has middle text)', () => {
    expect(middleText).toEqual({});
  });
});

describe('endingText', () => {
  it('interpolates the moderator name where applicable', () => {
    expect(endingText('Jane').author_approval).toBe(' is approved by Jane for publishing.');
    expect(endingText('Jane').author_reject).toBe(' is rejected by Jane.');
  });

  it('has the long bucket-retention sentence verbatim', () => {
    expect(endingText('').bucket_expiration_warning).toBe(
      " will start deleting files in 24 hours according to its retention policy (files are removed based on each file's creation date; the bucket itself will remain).",
    );
  });
});

describe('formatName', () => {
  it('passes short names through unchanged', () => {
    expect(formatName('short')).toBe('short');
  });

  it('truncates to 33 chars with an ellipsis', () => {
    const long = 'a'.repeat(40);
    expect(formatName(long)).toBe(`${'a'.repeat(33)}...`);
  });

  it('returns "" for undefined', () => {
    expect(formatName(undefined)).toBe('');
  });
});

describe('formatIndexMessage', () => {
  it('reports failure when meta.error is a non-empty string', () => {
    expect(formatIndexMessage({ indexName: 'idx', error: 'boom' })).toBe('Index idx is failed.');
  });

  it('ignores a whitespace-only error (parity: error.trim())', () => {
    expect(formatIndexMessage({ indexName: 'idx', error: '   ', indexed: 3 })).toBe(
      'Index idx is successfully created: { "indexed": 3 }',
    );
  });

  it('reports a scheduled reindex', () => {
    expect(formatIndexMessage({ indexName: 'idx', reindex: true, updated: 5, indexed: 10, initiator: 'schedule' })).toBe(
      'Index idx is successfully reindexed by schedule. { "reindexed": 5, "indexed": 10 }',
    );
  });

  it('reports a manual reindex without the "by schedule" suffix', () => {
    expect(formatIndexMessage({ indexName: 'idx', reindex: true, updated: 5, indexed: 10, initiator: 'user' })).toBe(
      'Index idx is successfully reindexed. { "reindexed": 5, "indexed": 10 }',
    );
  });

  it('reports creation as the default branch', () => {
    expect(formatIndexMessage({ indexName: 'idx', indexed: 7 })).toBe('Index idx is successfully created: { "indexed": 7 }');
  });

  it('substitutes {INDEX_LINK} placeholder when withLink is true', () => {
    expect(formatIndexMessage({ indexed: 1 }, true)).toBe('Index {INDEX_LINK} is successfully created: { "indexed": 1 }');
  });

  it('falls back to "Index" when indexName is absent and withLink is false', () => {
    expect(formatIndexMessage({ indexed: 1 })).toBe('Index Index is successfully created: { "indexed": 1 }');
  });
});

describe('parseLegacyInformation', () => {
  it('agent_unpublished: builds agentUnpublishedMeta with the reason suffix', () => {
    const meta: FullNotificationMeta = { sourceApplicationId: 'a1', sourceVersionId: 'v1', reason: 'policy' };
    const result = parseLegacyInformation('agent_unpublished', meta, '7');
    expect(result.agentUnpublishedMeta).toEqual({
      sourceVersionId: 'v1',
      sourceApplicationId: 'a1',
      projectId: '7',
      reasonSuffix: ' Reason: policy',
    });
  });

  it('agent_unpublished: empty reason suffix when meta.reason is absent', () => {
    const result = parseLegacyInformation('agent_unpublished', {}, '7');
    expect(result.agentUnpublishedMeta?.reasonSuffix).toBe('');
  });

  it('token_expiring: firstLinkInfo.linkText is "Configuration" (dead link, no urlMap entry)', () => {
    const result = parseLegacyInformation('token_expiring', { tokenName: 'tok' }, '7');
    expect(result.leadingTextParam1).toBe('tok');
    expect(result.firstLinkInfo).toEqual({ linkText: 'Configuration' });
  });

  it('spending_limit_expiring: firstLinkInfo.linkText is "settings section"', () => {
    const result = parseLegacyInformation('spending_limit_expiring', {}, '7');
    expect(result.firstLinkInfo).toEqual({ linkText: 'settings section' });
  });

  it('rates: leadingTextParam1 is the stringified rates count, linkInfo has no isNewTab', () => {
    const result = parseLegacyInformation('rates', { ratesCount: 3, promptName: 'P', promptId: 'p1' }, '7');
    expect(result.leadingTextParam1).toBe('3');
    expect(result.firstLinkInfo).toEqual({ linkText: 'P', id: 'p1' });
  });

  it('comments: uses both commentsCount and repliesCount', () => {
    const result = parseLegacyInformation('comments', { commentsCount: 2, repliesCount: 5, promptName: 'P' }, '7');
    expect(result.leadingTextParam1).toBe('2');
    expect(result.leadingTextParam2).toBe('5');
  });

  it('reward_new_level: leadingTextParam1 is the stringified new level, no link', () => {
    const result = parseLegacyInformation('reward_new_level', { newLevel: 4 }, '7');
    expect(result.leadingTextParam1).toBe('4');
    expect(result.firstLinkInfo).toBeUndefined();
  });

  it('contributor_request_for_publish_approve: leadingTextParam1 is the author name', () => {
    const result = parseLegacyInformation(
      'contributor_request_for_publish_approve',
      { authorName: 'Author', promptName: 'P', promptId: 'p1' },
      '7',
    );
    expect(result.leadingTextParam1).toBe('Author');
    expect(result.firstLinkInfo).toEqual({ linkText: 'P', id: 'p1' });
  });

  it('user_was_added_to_some_project_as_teammate: pluralizes "is"/"are"', () => {
    const single = parseLegacyInformation('user_was_added_to_some_project_as_teammate', { users: ['A'] }, '7');
    expect(single.leadingTextParam1).toBe('A is');
    const multi = parseLegacyInformation('user_was_added_to_some_project_as_teammate', { users: ['A', 'B'] }, '7');
    expect(multi.leadingTextParam1).toBe('A, B are');
  });

  it('chat_user_added: isNewTab true, conversationId as link id', () => {
    const result = parseLegacyInformation('chat_user_added', { initiatorName: 'Alice', conversationId: 'c1', conversationName: 'Chat' }, '7');
    expect(result.leadingTextParam1).toBe('Alice');
    expect(result.leadingTextParam2).toBe('you ');
    expect(result.firstLinkInfo).toEqual({ linkText: 'Chat', id: 'c1', isNewTab: true });
  });

  it('chat_user_added: falls back to "You were "/"" when initiatorName is absent', () => {
    const result = parseLegacyInformation('chat_user_added', {}, '7');
    expect(result.leadingTextParam1).toBe('You were ');
    expect(result.leadingTextParam2).toBe('');
  });

  it('index_data_changed: firstLinkInfo present only when toolkitId exists', () => {
    expect(parseLegacyInformation('index_data_changed', {}, '7').firstLinkInfo).toBeUndefined();
    const withToolkit = parseLegacyInformation('index_data_changed', { toolkitId: 't1', indexName: 'idx' }, '7');
    expect(withToolkit.firstLinkInfo).toEqual({ linkText: 'idx', id: 't1', indexName: 'idx', isNewTab: true });
  });

  it('bucket_expiration_warning: linkText falls back to "Bucket"', () => {
    const result = parseLegacyInformation('bucket_expiration_warning', {}, '7');
    expect(result.firstLinkInfo).toEqual({ linkText: 'Bucket', id: undefined, isNewTab: true });
  });

  it('personal_access_token_expiring: static "Manage Personal Access Tokens" link', () => {
    const result = parseLegacyInformation('personal_access_token_expiring', { tokenName: 'tok' }, '7');
    expect(result.leadingTextParam1).toBe('tok');
    expect(result.firstLinkInfo).toEqual({ linkText: 'Manage Personal Access Tokens', isNewTab: true });
  });

  it('returns {} for an event type parseInformation does not handle (e.g. moderation_approved)', () => {
    expect(parseLegacyInformation('moderation_approved', {}, '7')).toEqual({});
  });
});
