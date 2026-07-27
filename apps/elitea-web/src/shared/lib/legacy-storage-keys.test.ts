import { describe, expect, it } from 'vitest';

import {
  ActiveConversationParticipantKey,
  PermissionStorageKey,
  ProjectIdStorageKey,
  ProjectNameStorageKey,
  PublicPermissionStorageKey,
  SoundNotificationsStorageKey,
} from './legacy-storage-keys';

describe('legacy (pre-namespace) storage key literals', () => {
  it('preserves the exact old-app key strings for the X5 migration', () => {
    expect(ProjectIdStorageKey).toBe('elitea_ui.project.id');
    expect(ProjectNameStorageKey).toBe('elitea_ui.project.name');
    expect(PublicPermissionStorageKey).toBe('elitea_ui.public_permission');
    expect(PermissionStorageKey).toBe('elitea_ui.project_permission');
    expect(SoundNotificationsStorageKey).toBe('elitea_ui.sound_notifications');
    expect(ActiveConversationParticipantKey).toBe('ActiveConversationParticipantKey');
  });
});
