import { beforeEach, describe, expect, it } from 'vitest';

import { installWebStorageShim } from '@/test/webstorage';

installWebStorageShim();

import { readPersistedCollapsed, writePersistedCollapsed } from '../lib/collapsedPersistence';

beforeEach(() => {
  window.localStorage.clear();
});

describe('collapsedPersistence', () => {
  it('defaults to not-collapsed when nothing is persisted', () => {
    expect(readPersistedCollapsed()).toBe(false);
  });

  it('round-trips a persisted true value', () => {
    writePersistedCollapsed(true);
    expect(readPersistedCollapsed()).toBe(true);
    expect(window.localStorage.getItem('el.sidebar.collapsed')).toBe('1');
  });

  it('round-trips a persisted false value', () => {
    writePersistedCollapsed(true);
    writePersistedCollapsed(false);
    expect(readPersistedCollapsed()).toBe(false);
    expect(window.localStorage.getItem('el.sidebar.collapsed')).toBe('0');
  });
});
