import { describe, expect, it } from 'vitest';

import { DEFAULT_FOLDER_NAME } from './types';

describe('DEFAULT_FOLDER_NAME', () => {
  it('matches the old app\'s DefaultFolderName constant', () => {
    expect(DEFAULT_FOLDER_NAME).toBe('New folder');
  });
});
