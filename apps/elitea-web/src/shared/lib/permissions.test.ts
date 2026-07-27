import { describe, expect, it } from 'vitest';

import { PERMISSIONS, PERMISSION_GROUPS } from './permissions';

describe('PERMISSIONS', () => {
  it('preserves the exact permission-string values consumed by the backend RBAC check', () => {
    expect(PERMISSIONS.chat.list).toBe('models.chat.conversations.list');
    expect(PERMISSIONS.chat.canvas.create).toBe('models.chat.canvas.create');
    expect(PERMISSIONS.chat.folders.delete).toBe('models.chat.folders.delete');
    expect(PERMISSIONS.applications.publish).toBe('models.applications.publish.post');
    expect(PERMISSIONS.pipelines.list).toBe('models.applications.public_applications.list');
    expect(PERMISSIONS.users.delete).toBe('configuration.users.users.delete');
    expect(PERMISSIONS.projectContext.edit).toBe('models.project_context.edit');
    expect(PERMISSIONS.secrets.unsecret).toBe('configuration.secrets.secret.unsecret');
    expect(PERMISSIONS.artifacts.buckets.view).toBe('configuration.artifacts.buckets.view');
    expect(PERMISSIONS.toolkits.export).toBe('models.applications.tools.export');
    expect(PERMISSIONS.configuration.update).toBe('configurations.configuration.update');
    expect(PERMISSIONS.litellm.edit).toBe('configuration.litellm.edit');
    expect(PERMISSIONS.index.schedule).toBe('models.applications.index_meta.edit');
  });
});

describe('PERMISSION_GROUPS', () => {
  it('maps each nav group to its gating permission(s)', () => {
    expect(PERMISSION_GROUPS.chat).toEqual([PERMISSIONS.chat.folders.get]);
    expect(PERMISSION_GROUPS.agents).toEqual([PERMISSIONS.applications.list]);
    expect(PERMISSION_GROUPS.pipelines).toEqual([PERMISSIONS.pipelines.list]);
    expect(PERMISSION_GROUPS.credentials).toEqual([PERMISSIONS.toolkits.list]);
    expect(PERMISSION_GROUPS.artifacts).toEqual([PERMISSIONS.artifacts.view]);
    expect(PERMISSION_GROUPS.toolkits).toEqual([PERMISSIONS.toolkits.list]);
  });
});
