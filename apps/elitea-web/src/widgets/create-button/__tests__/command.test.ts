import { describe, expect, it } from 'vitest';

import {
  currentEntityFromPathname,
  defaultEntityKind,
  hasCreatePermission,
  isSimpleCreateRoute,
  resolveCreateCommand,
} from '../lib/command';
import { CREATE_ENTITY_PERMISSIONS, createEntityOptions } from '../lib/constants';

describe('createEntityOptions', () => {
  it('lists exactly the 13 SHELL-013..025 entities in dropdown order', () => {
    const options = createEntityOptions();
    expect(options.map((option) => option.kind)).toEqual([
      'chat',
      'agent',
      'skill',
      'pipeline',
      'credential',
      'toolkit',
      'application',
      'mcp',
      'bucket',
      'configuration',
      'token',
      'secret',
      'user',
    ]);
  });
});

describe('isSimpleCreateRoute (SHELL-026)', () => {
  it.each([
    ['/onboarding', true],
    ['/help-center', true],
    ['/agents-hub', true],
    ['/settings/personalization', true],
    ['/settings/notifications', true],
    ['/chat', false],
    ['/agents', false],
    ['/artifacts', false],
  ])('%s -> %s', (pathname, expected) => {
    expect(isSimpleCreateRoute(pathname)).toBe(expected);
  });
});

describe('currentEntityFromPathname', () => {
  it.each([
    ['/chat', 'chat'],
    ['/chat/abc-123', 'chat'],
    ['/agents', 'agent'],
    ['/agents/latest/agent-1', 'agent'],
    ['/pipelines/latest/pipe-1/v1', 'pipeline'],
    ['/skills/all', 'skill'],
    ['/toolkits', 'toolkit'],
    ['/mcps/create', 'mcp'],
    ['/credentials', 'credential'],
    ['/artifacts', 'bucket'],
    ['/apps/catalog', 'application'],
    ['/apps/applications', 'application'],
    ['/settings/model-configuration', 'configuration'],
    ['/settings/tokens', 'token'],
    ['/settings/secrets', 'secret'],
    ['/settings/users', 'user'],
  ])('%s -> %s', (pathname, expected) => {
    expect(currentEntityFromPathname(pathname)).toBe(expected);
  });

  it('returns undefined for an unrecognised route', () => {
    expect(currentEntityFromPathname('/onboarding')).toBeUndefined();
    expect(currentEntityFromPathname('/mode-switch')).toBeUndefined();
  });

  it('does NOT match "agent" for /agents-hub, even though it contains the /agents substring', () => {
    // Regression proof for the isSimpleCreateRoute-precedes-substring-match fix.
    expect(currentEntityFromPathname('/agents-hub')).toBeUndefined();
    expect(isSimpleCreateRoute('/agents-hub')).toBe(true);
  });
});

describe('defaultEntityKind', () => {
  it('falls back to chat on an unrecognised route (old app default)', () => {
    expect(defaultEntityKind('/onboarding')).toBe('chat');
  });

  it('uses the route-implied kind when one exists', () => {
    expect(defaultEntityKind('/agents')).toBe('agent');
  });
});

describe('hasCreatePermission', () => {
  it('allows an entity with no required permissions regardless of the permission set', () => {
    expect(hasCreatePermission('credential', new Set())).toBe(true);
    expect(hasCreatePermission('token', new Set())).toBe(true);
  });

  it('denies a gated entity when none of its required permissions are held', () => {
    expect(hasCreatePermission('agent', new Set(['some.other.permission']))).toBe(false);
  });

  it('allows a gated entity when at least one required permission is held', () => {
    const [firstAgentPermission] = CREATE_ENTITY_PERMISSIONS.agent ?? [];
    expect(firstAgentPermission).toBeDefined();
    expect(hasCreatePermission('agent', new Set([firstAgentPermission as string]))).toBe(true);
  });

  it('requires ANY (not ALL) of a multi-permission entity’s permissions — chat needs folders.create OR chat.create', () => {
    const chatPerms = CREATE_ENTITY_PERMISSIONS.chat ?? [];
    expect(chatPerms.length).toBeGreaterThan(1);
    expect(hasCreatePermission('chat', new Set([chatPerms[1] as string]))).toBe(true);
  });
});

describe('resolveCreateCommand', () => {
  it('chat: navigates to /chat with ?create=1, no replace from a non-create page', () => {
    expect(resolveCreateCommand('chat', '/agents')).toEqual({
      to: '/chat',
      search: { create: '1' },
      replace: false,
    });
  });

  it('replaces (does not push) when already on a /create page', () => {
    expect(resolveCreateCommand('skill', '/agents/create')).toEqual({
      to: '/skills/create',
      search: {},
      replace: true,
    });
  });

  it('application: routes to the catalog tab, not a dedicated create page', () => {
    expect(resolveCreateCommand('application', '/apps')).toEqual({
      to: '/apps/catalog',
      search: {},
      replace: false,
    });
  });

  it('configuration: carries the from=model-configuration search param', () => {
    expect(resolveCreateCommand('configuration', '/settings/model-configuration')).toEqual({
      to: '/settings/create-configuration',
      search: { from: 'model-configuration' },
      replace: false,
    });
  });

  it('secret: stays on settings/secrets with ?createSecret=1, always pushes (never replace)', () => {
    expect(resolveCreateCommand('secret', '/settings/secrets/create')).toEqual({
      to: '/settings/secrets',
      search: { createSecret: '1' },
      replace: false,
    });
  });

  it('user: stays on settings/users with ?inviteUsers=1, always pushes', () => {
    expect(resolveCreateCommand('user', '/settings/users')).toEqual({
      to: '/settings/users',
      search: { inviteUsers: '1' },
      replace: false,
    });
  });

  it('bucket: routes to /artifacts/create-bucket', () => {
    expect(resolveCreateCommand('bucket', '/artifacts')).toEqual({
      to: '/artifacts/create-bucket',
      search: {},
      replace: false,
    });
  });

  it('agent: routes to /agents/create', () => {
    expect(resolveCreateCommand('agent', '/agents')).toEqual({ to: '/agents/create', search: {}, replace: false });
  });

  it('pipeline: routes to /pipelines/create', () => {
    expect(resolveCreateCommand('pipeline', '/pipelines')).toEqual({
      to: '/pipelines/create',
      search: {},
      replace: false,
    });
  });

  it('toolkit: routes to /toolkits/create', () => {
    expect(resolveCreateCommand('toolkit', '/toolkits')).toEqual({
      to: '/toolkits/create',
      search: {},
      replace: false,
    });
  });

  it('mcp: routes to /mcps/create', () => {
    expect(resolveCreateCommand('mcp', '/mcps')).toEqual({ to: '/mcps/create', search: {}, replace: false });
  });

  it('credential: routes to /credentials/create-credential', () => {
    expect(resolveCreateCommand('credential', '/credentials')).toEqual({
      to: '/credentials/create-credential',
      search: {},
      replace: false,
    });
  });

  it('token: routes to /settings/create-personal-token', () => {
    expect(resolveCreateCommand('token', '/settings/tokens')).toEqual({
      to: '/settings/create-personal-token',
      search: {},
      replace: false,
    });
  });

  it('secret/user: always push (never replace), even from a /create page', () => {
    expect(resolveCreateCommand('secret', '/agents/create').replace).toBe(false);
    expect(resolveCreateCommand('user', '/agents/create').replace).toBe(false);
  });
});
