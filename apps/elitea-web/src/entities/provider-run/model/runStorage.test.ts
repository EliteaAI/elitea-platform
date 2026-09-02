import { afterEach, describe, expect, it } from 'vitest';
import { createStorage } from '@/shared/lib/storage';
import { createRunStorage } from './runStorage';

const KEY = 'test.run.1.2';
const TTL = 1000;

afterEach(() => {
  createStorage('local').remove(KEY);
});

describe('createRunStorage', () => {
  it('round-trips a run and clears it', () => {
    let now = 10_000;
    const storage = createRunStorage({ key: KEY, ttlMs: TTL, now: () => now });
    expect(storage.load()).toBeNull();
    storage.save({ invocationId: 'inv', startedAt: now });
    expect(storage.load()).toEqual({ invocationId: 'inv', startedAt: 10_000 });
    now += TTL - 1;
    expect(storage.load()).toEqual({ invocationId: 'inv', startedAt: 10_000 });
    storage.clear();
    expect(storage.load()).toBeNull();
  });

  it('discards a run at the TTL, and removes it from storage', () => {
    let now = 10_000;
    const storage = createRunStorage({ key: KEY, ttlMs: TTL, now: () => now });
    storage.save({ invocationId: 'inv', startedAt: now });
    now += TTL;
    expect(storage.load()).toBeNull();
    // Gone, not merely hidden: a later load within a new TTL window must not
    // resurrect it.
    expect(createStorage('local').getJSON(KEY)).toBeNull();
  });

  it('treats a corrupt or foreign value as no run', () => {
    const storage = createRunStorage({ key: KEY, ttlMs: TTL });
    createStorage('local').setJSON(KEY, { invocationId: '', startedAt: 1 });
    expect(storage.load()).toBeNull();
    createStorage('local').setJSON(KEY, { invocationId: 'inv' });
    expect(storage.load()).toBeNull();
    createStorage('local').set(KEY, 'not json');
    expect(storage.load()).toBeNull();
  });

  it('keeps runs under different keys apart', () => {
    const a = createRunStorage({ key: KEY, ttlMs: TTL });
    const b = createRunStorage({ key: KEY + '.other', ttlMs: TTL });
    a.save({ invocationId: 'a', startedAt: Date.now() });
    expect(b.load()).toBeNull();
    b.clear();
    expect(a.load()?.invocationId).toBe('a');
  });
});
