import { describe, expect, it } from 'vitest';

import {
  ApplicationsTabs,
  AppsTabs,
  CredentialsTabs,
  PrivateApplicationTabs,
  SkillsTabs,
  ToolkitsTabs,
  UserPublicTabs,
  UserSettingsTabs,
  publicTabs,
} from './tabs';

describe('tab-key arrays', () => {
  it('preserves the exact old-app tab sets and order', () => {
    expect(publicTabs).toEqual(['latest', 'my-liked', 'trending']);
    expect(ApplicationsTabs).toEqual(['latest', 'my-liked', 'trending', 'admin']);
    expect(SkillsTabs).toEqual(['all']);
    expect(ToolkitsTabs).toEqual(['all', 'my-liked', 'trending', 'admin']);
    expect(AppsTabs).toEqual(['applications', 'catalog']);
    expect(CredentialsTabs).toEqual(['all']);
    expect(PrivateApplicationTabs).toEqual(['all', 'drafts', 'published', 'moderation', 'approval', 'rejected']);
    expect(UserSettingsTabs).toEqual(['information', 'tokens', 'secrets', 'projects']);
    expect(UserPublicTabs).toEqual(['all', 'agents', 'pipelines', 'toolkits', 'MCPs']);
  });
});
