import { describe, expect, it } from 'vitest';

import { isPipelineDetailPath, pathnameStartsWith } from './routeMatch';

describe('isPipelineDetailPath', () => {
  it('matches /pipelines/create', () => {
    expect(isPipelineDetailPath('/pipelines/create')).toBe(true);
  });

  it('matches /pipelines/:tab/:agentId', () => {
    expect(isPipelineDetailPath('/pipelines/latest/42')).toBe(true);
  });

  it('matches /pipelines/:tab/:agentId/:version', () => {
    expect(isPipelineDetailPath('/pipelines/latest/42/7')).toBe(true);
  });

  it('does not match the tabs listing page itself', () => {
    expect(isPipelineDetailPath('/pipelines/latest')).toBe(false);
  });

  it('does not match an unrelated path', () => {
    expect(isPipelineDetailPath('/agents/latest/42')).toBe(false);
    expect(isPipelineDetailPath('/chat')).toBe(false);
  });
});

describe('pathnameStartsWith', () => {
  it('is true when pathname starts with the prefix', () => {
    expect(pathnameStartsWith('/chat/123', '/chat')).toBe(true);
    expect(pathnameStartsWith('/chat', '/chat')).toBe(true);
  });

  it('is false otherwise', () => {
    expect(pathnameStartsWith('/pipelines/latest', '/chat')).toBe(false);
  });
});
