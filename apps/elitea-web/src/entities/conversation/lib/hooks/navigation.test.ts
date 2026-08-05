import { describe, expect, it } from 'vitest';

import { buildClearConversationUrl, buildConversationUrlChange, buildCreateConversationUrl, buildResetSearchParams, resolveConversationIdFromUrl } from './navigation';

describe('resolveConversationIdFromUrl', () => {
  it('prefers the route param over the search param', () => {
    expect(resolveConversationIdFromUrl('r1', 's1')).toBe('r1');
  });

  it('falls back to the search param', () => {
    expect(resolveConversationIdFromUrl(undefined, 's1')).toBe('s1');
  });

  it('is undefined when neither is present', () => {
    expect(resolveConversationIdFromUrl(undefined, undefined)).toBeUndefined();
    expect(resolveConversationIdFromUrl('', null)).toBeUndefined();
  });
});

describe('buildConversationUrlChange', () => {
  it('navigates to the new conversation, dropping other search params, when the id changes', () => {
    expect(buildConversationUrlChange('old', { foo: 'bar' }, 'new')).toEqual({ pathname: '/chat/new', search: {} });
  });

  it('carries only the name param when the id changes and a name is given', () => {
    expect(buildConversationUrlChange('old', {}, 'new', 'Hello')).toEqual({ pathname: '/chat/new', search: { name: 'Hello' } });
  });

  it('preserves existing search params and only replaces name when the id is unchanged and a name is given', () => {
    expect(buildConversationUrlChange('same', { conversation: 'same', name: 'Old' }, 'same', 'New')).toEqual({
      pathname: '/chat/same',
      search: { conversation: 'same', name: 'New' },
    });
  });

  it('is a no-op when the id is unchanged and no name is given', () => {
    expect(buildConversationUrlChange('same', {}, 'same')).toBeNull();
  });
});

describe('buildClearConversationUrl / buildCreateConversationUrl / buildResetSearchParams', () => {
  it('clear navigates to /chat with no search params', () => {
    expect(buildClearConversationUrl()).toEqual({ pathname: '/chat', search: {} });
  });

  it('create navigates to /chat with the create flag', () => {
    expect(buildCreateConversationUrl()).toEqual({ pathname: '/chat', search: { create: '1' } });
  });

  it('reset drops every search param', () => {
    expect(buildResetSearchParams()).toEqual({});
  });
});
