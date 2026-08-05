import { describe, expect, it } from 'vitest';

import { McpCategory } from './mcp.constants';

describe('McpCategory', () => {
  it('carries the two baseline category labels verbatim', () => {
    expect(McpCategory).toEqual({ Local: 'Local', Remote: 'Remote' });
  });
});
