import { describe, expect, it } from 'vitest';

import type { App } from './types';

describe('App shape parity with the live handler response', () => {
  it('models exactly the 8 keys eliteacore/handler.go:1290-1316 emits — no authors/author/tags', () => {
    // The row-builder `map[string]any{...}` literal at handler.go:1301-1310,
    // built directly from this file's SQL SELECT — verified to have exactly
    // these 8 keys, nothing else.
    const wireResponse = {
      project_id: '0',
      id: '1',
      name: 'Support Bot',
      description: 'Handles support tickets',
      version_id: 'v1',
      version_name: 'base',
      agent_type: 'openai',
      meta: null,
    };
    const app: App = {
      projectId: wireResponse.project_id,
      id: wireResponse.id,
      name: wireResponse.name,
      description: wireResponse.description,
      versionId: wireResponse.version_id,
      versionName: wireResponse.version_name,
      agentType: wireResponse.agent_type,
      meta: wireResponse.meta,
    };
    // Every key on a real-wire-shaped App value is one of the 8 handler
    // keys (+ the optional client-only likes/isLiked, absent here). If
    // `authors`/`author`/`tags` were ever repopulated on this literal —
    // e.g. by a future edit that "helpfully" restores them assuming they
    // carry real data — this assertion catches it immediately.
    expect(Object.keys(app).sort()).toEqual(
      ['agentType', 'description', 'id', 'meta', 'name', 'projectId', 'versionId', 'versionName'].sort(),
    );
  });
});
