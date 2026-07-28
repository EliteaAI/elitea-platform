import { describe, expect, it } from 'vitest';

import { isPrebuildMcpType } from './mcpType';

describe('isPrebuildMcpType', () => {
  it('is true for a prebuilt mcp_ type', () => {
    expect(isPrebuildMcpType('mcp_github')).toBe(true);
  });

  it('is false for the bare remote-mcp type', () => {
    expect(isPrebuildMcpType('mcp')).toBe(false);
  });

  it('is false for a non-mcp type', () => {
    expect(isPrebuildMcpType('github')).toBe(false);
  });

  it('is false for undefined', () => {
    expect(isPrebuildMcpType(undefined)).toBe(false);
  });
});
