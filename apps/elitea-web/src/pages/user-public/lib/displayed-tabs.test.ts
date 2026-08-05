import { describe, expect, it } from 'vitest';

import { AGENTS_TAB_ADMIN_PERMISSION } from './constants';
import { computeDisplayedTabs } from './displayed-tabs';

describe('computeDisplayedTabs (parity: UserPublic.jsx:68-80 + usePermissions.jsx:8-10)', () => {
  it('hides every tab when the user has zero permissions', () => {
    expect(computeDisplayedTabs([], false)).toEqual({
      all: false,
      agents: false,
      pipelines: false,
      toolkits: false,
      MCPs: false,
    });
  });

  it('always shows the ungated tabs (all/pipelines/toolkits/MCPs) once any permission is present', () => {
    const result = computeDisplayedTabs(['some.unrelated.permission'], false);
    expect(result.all).toBe(true);
    expect(result.pipelines).toBe(true);
    expect(result.toolkits).toBe(true);
    expect(result.MCPs).toBe(true);
  });

  it('hides the agents tab without the admin permission, outside the Public project', () => {
    const result = computeDisplayedTabs(['some.unrelated.permission'], false);
    expect(result.agents).toBe(false);
  });

  it('shows the agents tab with the admin permission', () => {
    const result = computeDisplayedTabs([AGENTS_TAB_ADMIN_PERMISSION], false);
    expect(result.agents).toBe(true);
  });

  it('shows the agents tab inside the Public project even without the admin permission', () => {
    const result = computeDisplayedTabs(['some.unrelated.permission'], true);
    expect(result.agents).toBe(true);
  });
});
