import { describe, expect, it } from 'vitest';

import {
  ConfigurationMode,
  configurationDoesNotMatchAnything,
  isCreateConfigurationMode,
  isManualOrCreateConfigurationMode,
  matchConfigurationForTitle,
} from './toolConfigurationMode';

describe('isCreateConfigurationMode', () => {
  it('is true for CreatePersonal and CreateProject', () => {
    expect(isCreateConfigurationMode(ConfigurationMode.CreatePersonal)).toBe(true);
    expect(isCreateConfigurationMode(ConfigurationMode.CreateProject)).toBe(true);
  });

  it('is false for Manual and any other title', () => {
    expect(isCreateConfigurationMode(ConfigurationMode.Manual)).toBe(false);
    expect(isCreateConfigurationMode('My Saved Config')).toBe(false);
  });
});

describe('isManualOrCreateConfigurationMode', () => {
  it('is true for Manual, CreatePersonal and CreateProject', () => {
    expect(isManualOrCreateConfigurationMode(ConfigurationMode.Manual)).toBe(true);
    expect(isManualOrCreateConfigurationMode(ConfigurationMode.CreatePersonal)).toBe(true);
    expect(isManualOrCreateConfigurationMode(ConfigurationMode.CreateProject)).toBe(true);
  });

  it('is false for a real configuration title', () => {
    expect(isManualOrCreateConfigurationMode('My Saved Config')).toBe(false);
  });
});

describe('configurationDoesNotMatchAnything', () => {
  it('is false when there is no title', () => {
    expect(configurationDoesNotMatchAnything(undefined, false, [])).toBe(false);
  });

  it('is false for Manual/Create modes', () => {
    expect(configurationDoesNotMatchAnything(ConfigurationMode.Manual, false, [])).toBe(false);
  });

  it('is false while still fetching', () => {
    expect(configurationDoesNotMatchAnything('Missing Config', true, [])).toBe(false);
  });

  it('is true when the title matches nothing in the list', () => {
    expect(configurationDoesNotMatchAnything('Missing Config', false, [{ title: 'Other' }])).toBe(true);
  });

  it('is false when the title matches by top-level title', () => {
    expect(configurationDoesNotMatchAnything('My Config', false, [{ title: 'My Config' }])).toBe(false);
  });

  it('is false when the title matches by data.title', () => {
    expect(configurationDoesNotMatchAnything('My Config', false, [{ data: { title: 'My Config' } }])).toBe(false);
  });
});

describe('matchConfigurationForTitle', () => {
  const personalConfig = { project_id: 'p-personal', settings: { title: 'Shared Name' } };
  const otherConfig = { project_id: 'p-other', settings: { title: 'Shared Name' } };

  it('returns manual for a blank title', () => {
    expect(matchConfigurationForTitle([], undefined, 'p-personal', false)).toEqual({ kind: 'manual' });
  });

  it('prefers a personal-project title match when isPersonal is true', () => {
    expect(matchConfigurationForTitle([otherConfig, personalConfig], 'Shared Name', 'p-personal', true)).toEqual({
      kind: 'personal',
      configuration: personalConfig,
    });
  });

  it('falls back to a plain title match when isPersonal is false', () => {
    expect(matchConfigurationForTitle([otherConfig], 'Shared Name', 'p-personal', false)).toEqual({
      kind: 'title',
      configuration: otherConfig,
    });
  });

  it('falls back to manual when nothing matches', () => {
    expect(matchConfigurationForTitle([otherConfig], 'No Such Config', 'p-personal', false)).toEqual({
      kind: 'manual',
    });
  });
});
