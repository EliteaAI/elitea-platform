import { describe, expect, it } from 'vitest';

import { derivePageTitle } from '../lib/pageTitle';

describe('derivePageTitle', () => {
  it('falls back to the project name alone for the personal-space root', () => {
    expect(derivePageTitle('/', '', 'My Project')).toBe('My Project');
  });

  it('section - project, when no ?name= is present', () => {
    expect(derivePageTitle('/agents', '', 'My Project')).toBe('Agents - My Project');
  });

  it('section: name - project, when ?name= is present', () => {
    expect(derivePageTitle('/chat', 'Weekly sync', 'My Project')).toBe('Chat: Weekly sync - My Project');
  });

  it('does not confuse /agents-hub with /agents (prefix hazard)', () => {
    expect(derivePageTitle('/agents-hub', '', 'My Project')).toBe('Agent HUB - My Project');
  });

  it('settings: bare tab -> "Settings - project"', () => {
    expect(derivePageTitle('/settings', '', 'My Project')).toBe('Settings - My Project');
  });

  it('settings: known-tab special casing (personalization/notifications)', () => {
    expect(derivePageTitle('/settings/personalization', '', 'My Project')).toBe('Settings: Personalization - My Project');
    expect(derivePageTitle('/settings/notifications', '', 'My Project')).toBe('Settings: Notifications - My Project');
  });

  it('settings: an arbitrary tab is titled verbatim', () => {
    expect(derivePageTitle('/settings/secrets', '', 'My Project')).toBe('Settings: secrets - My Project');
  });

  it('an unrecognised route falls back to the project name alone', () => {
    expect(derivePageTitle('/mode-switch', '', 'My Project')).toBe('My Project');
  });

  it('tolerates an unknown project name (renders the empty string, not "undefined")', () => {
    expect(derivePageTitle('/agents', '', undefined)).toBe('Agents - ');
  });
});
