import { describe, expect, it } from 'vitest';

import { AppsTabs } from '@/shared/lib/tabs';

import { appsTabByIndex, appsTabIndex, defaultAppsTab, isApplicationsTab, normalizeAppsTab, searchForAppsTab } from './tabs';

describe('defaultAppsTab', () => {
  it('defaults to "applications" when the project has configured applications', () => {
    expect(defaultAppsTab(true)).toBe('applications');
  });

  it('defaults to "catalog" when the project has none', () => {
    expect(defaultAppsTab(false)).toBe('catalog');
  });
});

describe('normalizeAppsTab', () => {
  it('resolves the legacy "all" alias to "catalog", regardless of hasApplications', () => {
    expect(normalizeAppsTab('all', true)).toBe('catalog');
    expect(normalizeAppsTab('all', false)).toBe('catalog');
  });

  it('falls back to the default tab for a bare /apps (no :tab param)', () => {
    expect(normalizeAppsTab(undefined, true)).toBe('applications');
    expect(normalizeAppsTab(undefined, false)).toBe('catalog');
  });

  it('falls back to the default tab for an unrecognised :tab value', () => {
    expect(normalizeAppsTab('bogus', true)).toBe('applications');
  });

  it('passes a recognised tab straight through', () => {
    expect(normalizeAppsTab('applications', false)).toBe('applications');
    expect(normalizeAppsTab('catalog', true)).toBe('catalog');
  });
});

describe('appsTabIndex / isApplicationsTab', () => {
  it('indexes both real tabs', () => {
    expect(appsTabIndex('applications')).toBe(0);
    expect(appsTabIndex('catalog')).toBe(1);
  });

  it('only the applications tab reports isApplicationsTab', () => {
    expect(isApplicationsTab('applications')).toBe(true);
    expect(isApplicationsTab('catalog')).toBe(false);
  });
});

describe('appsTabByIndex', () => {
  it('maps each valid index back to its tab', () => {
    expect(appsTabByIndex(0)).toBe('applications');
    expect(appsTabByIndex(1)).toBe('catalog');
  });

  it('falls back to "applications" for an out-of-range index', () => {
    expect(appsTabByIndex(99)).toBe('applications');
    expect(appsTabByIndex(-1)).toBe('applications');
  });
});

describe('searchForAppsTab', () => {
  it('strips `view` when switching to the catalog tab', () => {
    expect(searchForAppsTab(AppsTabs[1], { view: 'list' })).toEqual({});
  });

  it('leaves search untouched for the applications tab (same reference)', () => {
    const search = { view: 'list' };
    expect(searchForAppsTab(AppsTabs[0], search)).toBe(search);
  });

  it('returns the SAME reference on the catalog tab when there was no `view` to strip', () => {
    const search = {};
    expect(searchForAppsTab(AppsTabs[1], search)).toBe(search);
  });

  it('returns a NEW object when it actually strips `view`', () => {
    const search = { view: 'list' };
    expect(searchForAppsTab(AppsTabs[1], search)).not.toBe(search);
  });
});
