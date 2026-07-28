import { describe, expect, it } from 'vitest';

import { ToolEvents, ToolTypes } from '@/entities/toolkit';

import { ToolEvents as ReExportedToolEvents, ToolTypes as ReExportedToolTypes } from './toolkitForm.constants';

describe('toolkitForm.constants re-export', () => {
  it('re-exports entities/toolkit.ToolEvents by identity (single source of truth, no duplicate literal)', () => {
    expect(ReExportedToolEvents).toBe(ToolEvents);
  });

  it('re-exports entities/toolkit.ToolTypes by identity (single source of truth, no duplicate literal)', () => {
    expect(ReExportedToolTypes).toBe(ToolTypes);
  });

  it('carries the jira/confluence entries getToolComponent.ts depends on', () => {
    expect(ReExportedToolTypes.jira.value).toBe('jira');
    expect(ReExportedToolTypes.confluence.value).toBe('confluence');
  });
});
