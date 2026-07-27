import { describe, expect, it } from 'vitest';

import {
  CREATE_VERSION,
  DEFAULT_PARTICIPANT_NAME,
  DefaultConversationName,
  DefaultFolderName,
  PRIVATE_PROJECT_NAME,
  PUBLIC_PROJECT_NAME,
  SAVE,
} from './copy';

describe('action/entity-name copy constants', () => {
  it('preserves the exact old-app string values', () => {
    expect(SAVE).toBe('Save');
    expect(CREATE_VERSION).toBe('Create version');
    expect(PUBLIC_PROJECT_NAME).toBe('Public');
    expect(PRIVATE_PROJECT_NAME).toBe('Private');
    expect(DEFAULT_PARTICIPANT_NAME).toBe('Elitea');
    expect(DefaultConversationName).toBe('New Chat');
    expect(DefaultFolderName).toBe('New folder');
  });
});
