import { describe, expect, it } from 'vitest';

import { ContentType } from './content-type';

describe('ContentType', () => {
  it('preserves the exact old-app member set (constants.js:434-471)', () => {
    expect(Object.keys(ContentType)).toHaveLength(36);
    expect(ContentType.MyLibraryAll).toBe('MyLibraryAll');
    expect(ContentType.ApplicationRejected).toBe('ApplicationRejected');
    expect(ContentType.PipelineRejected).toBe('PipelineRejected');
    expect(ContentType.ToolkitAdmin).toBe('ToolkitAdmin');
    expect(ContentType.MCPAll).toBe('MCPAll');
    expect(ContentType.CredentialAll).toBe('CredentialAll');
    expect(ContentType.SkillAll).toBe('SkillAll');
  });

  it('every value equals its own key (self-mirroring enum)', () => {
    for (const [key, value] of Object.entries(ContentType)) {
      expect(value).toBe(key);
    }
  });
});
