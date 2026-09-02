import { beforeEach, describe, expect, it } from 'vitest';

import { STORAGE_NAMESPACE, clearNamespace } from '@/shared/lib/storage';

import { GENERATION_STATE_TTL_MS, createGenerationStorage } from './generationStorage';

function allKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('createGenerationStorage', () => {
  it('remembers a run and gives it back', () => {
    const storage = createGenerationStorage(7, 42, () => 1000);
    storage.save({ invocationId: 'inv-1', startedAt: 1000 });
    expect(storage.load()).toEqual({ invocationId: 'inv-1', startedAt: 1000 });
  });

  it('discards a run older than four hours, and removes it', () => {
    // The legacy TTL. A generation that died with its tab must not be shown as
    // running for ever on every later visit.
    let clock = 0;
    const storage = createGenerationStorage(7, 42, () => clock);
    storage.save({ invocationId: 'inv-1', startedAt: 0 });
    clock = GENERATION_STATE_TTL_MS - 1;
    expect(storage.load()).not.toBeNull();
    clock = GENERATION_STATE_TTL_MS;
    expect(storage.load()).toBeNull();
    expect(allKeys()).toHaveLength(0);
  });

  it('keeps one run per (project, toolkit)', () => {
    createGenerationStorage(7, 42).save({ invocationId: 'a', startedAt: Date.now() });
    createGenerationStorage(7, 43).save({ invocationId: 'b', startedAt: Date.now() });
    expect(createGenerationStorage(7, 42).load()?.invocationId).toBe('a');
    expect(createGenerationStorage(7, 43).load()?.invocationId).toBe('b');
  });

  it('reads a corrupt entry as none', () => {
    window.localStorage.setItem(`${STORAGE_NAMESPACE}deepwiki.generation.7.42`, '{"invocationId":""}');
    expect(createGenerationStorage(7, 42).load()).toBeNull();
  });

  it('lives inside the namespace the logout sweep clears', () => {
    createGenerationStorage(7, 42).save({ invocationId: 'a', startedAt: Date.now() });
    for (const key of allKeys()) expect(key.startsWith(STORAGE_NAMESPACE)).toBe(true);
    clearNamespace();
    expect(createGenerationStorage(7, 42).load()).toBeNull();
  });
});
