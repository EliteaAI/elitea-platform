import { beforeEach, describe, expect, it } from 'vitest';

import { STORAGE_NAMESPACE, clearNamespace } from '@/shared/lib/storage';

import { createWikiChatStorage } from './chatStorage';

function allStorageKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('createWikiChatStorage', () => {
  it('writes only inside the namespace, so a logout sweeps it', () => {
    // The defect this replaces: `deepwiki-chat-1-2` on the bare global
    // survives clearNamespace() and the next user finds the last one's
    // questions (issue #22).
    const storage = createWikiChatStorage(1, 2);
    storage.saveMessages([{ role: 'user', content: 'private' }]);
    storage.saveCapability('research');

    // Enumerated through the Storage API rather than Object.keys: jsdom does
    // not expose entries as own properties, so Object.keys returns [] and the
    // assertion would pass against a store full of un-namespaced keys.
    const keys = allStorageKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.startsWith(STORAGE_NAMESPACE)).toBe(true);
    }

    clearNamespace();
    expect(allStorageKeys()).toHaveLength(0);
    expect(createWikiChatStorage(1, 2).loadMessages()).toEqual([]);
  });

  it('keeps one conversation per wiki', () => {
    createWikiChatStorage(1, 2).saveMessages([{ role: 'user', content: 'first wiki' }]);
    createWikiChatStorage(1, 3).saveMessages([{ role: 'user', content: 'second wiki' }]);

    expect(createWikiChatStorage(1, 2).loadMessages()).toEqual([
      { role: 'user', content: 'first wiki' },
    ]);
    expect(createWikiChatStorage(1, 3).loadMessages()).toEqual([
      { role: 'user', content: 'second wiki' },
    ]);
  });

  it('reads a corrupt conversation as an empty one', () => {
    window.localStorage.setItem(`${STORAGE_NAMESPACE}deepwiki.chat.1.2`, '{not json');
    expect(createWikiChatStorage(1, 2).loadMessages()).toEqual([]);

    // Valid JSON of the WRONG SHAPE is just as bad: rendering an object as a
    // message list crashes the drawer on open.
    window.localStorage.setItem(`${STORAGE_NAMESPACE}deepwiki.chat.1.2`, '{"a":1}');
    expect(createWikiChatStorage(1, 2).loadMessages()).toEqual([]);
  });

  it('reads an unrecognised capability as none', () => {
    window.localStorage.setItem(`${STORAGE_NAMESPACE}deepwiki.chat.capability.1.2`, 'telepathy');
    expect(createWikiChatStorage(1, 2).loadCapability()).toBeNull();

    createWikiChatStorage(1, 2).saveCapability('research');
    expect(createWikiChatStorage(1, 2).loadCapability()).toBe('research');
  });
});
